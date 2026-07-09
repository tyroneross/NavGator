/**
 * Owner-safe scan lease shared by every NavGator scan entrypoint.
 *
 * The caller supplies the canonical lock path (`<base>/.navgator/scan.lock`).
 * A complete record is written to an O_EXCL candidate and published with an
 * atomic no-overwrite hard link. Each owner receives a random token and keeps
 * its heartbeat current until owner-safe release.
 */
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
export const LOCK_FILENAME = 'scan.lock';
/** Grace period before an unreadable/corrupt record may be recovered. */
export const LOCK_TTL_MS = 60_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
function defaultPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        // EPERM means the process exists but this user cannot signal it.
        return error.code === 'EPERM';
    }
}
let cachedBootFingerprint;
function bootFingerprint() {
    if (cachedBootFingerprint)
        return cachedBootFingerprint;
    try {
        if (process.platform === 'linux') {
            const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim();
            if (bootId)
                return (cachedBootFingerprint = `linux:boot:${bootId}`);
        }
        if (process.platform === 'darwin') {
            const bootTime = execFileSync('sysctl', ['-n', 'kern.boottime'], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (bootTime)
                return (cachedBootFingerprint = `darwin:boot:${bootTime}`);
        }
    }
    catch {
        // Fall through to an uptime-derived boot identity.
    }
    const bootMinute = Math.round((Date.now() - os.uptime() * 1000) / 60_000);
    return (cachedBootFingerprint = `${process.platform}:boot:${bootMinute}`);
}
/** Best-effort cross-platform process-start identity for PID-reuse detection. */
function defaultProcessFingerprint(pid) {
    if (!defaultPidAlive(pid))
        return null;
    try {
        if (process.platform === 'linux') {
            const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
            const afterCommand = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
            // /proc/<pid>/stat field 22 is process start ticks; the slice starts at field 3.
            const startTicks = afterCommand[19];
            if (startTicks)
                return `linux:${bootFingerprint()}:start:${startTicks}`;
        }
        else if (process.platform === 'win32') {
            const started = execFileSync('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
            ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (started)
                return `win32:${bootFingerprint()}:start:${started}`;
        }
        else {
            const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (started)
                return `${process.platform}:${bootFingerprint()}:start:${started}`;
        }
    }
    catch {
        return null;
    }
    return null;
}
export function readScanLease(lockPath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        if (parsed.version !== 1 ||
            typeof parsed.pid !== 'number' ||
            typeof parsed.token !== 'string' ||
            typeof parsed.started_at !== 'number' ||
            typeof parsed.heartbeat_at !== 'number' ||
            typeof parsed.scan_type !== 'string' ||
            (parsed.owner_fingerprint !== undefined && typeof parsed.owner_fingerprint !== 'string')) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function formatContention(existing, now) {
    if (!existing)
        return 'Scan already in progress (unknown owner)';
    const ageSeconds = Math.max(0, Math.round((now - existing.heartbeat_at) / 1000));
    return `Scan already in progress (pid ${existing.pid}, heartbeat ${ageSeconds}s ago)`;
}
function canReclaim(record, isPidAlive, getProcessFingerprint) {
    // Never fence a valid record while its owner PID is alive. A SIGSTOP,
    // debugger pause, suspended laptop, or blocked event loop can delay the
    // heartbeat while the owner can still resume writes. Reclaiming that lease
    // would admit two writers. Heartbeat age remains diagnostic.
    if (!isPidAlive(record.pid))
        return true;
    if (record.owner_fingerprint) {
        const currentFingerprint = getProcessFingerprint(record.pid);
        if (currentFingerprint && currentFingerprint !== record.owner_fingerprint)
            return true;
    }
    return false;
}
/** Publish a fully-written record without ever exposing a partial lock file. */
function publishNewLease(lockPath, record) {
    const candidate = `${lockPath}.candidate.${record.pid}.${record.token}`;
    let fd;
    try {
        fd = fs.openSync(candidate, 'wx');
        fs.writeFileSync(fd, JSON.stringify(record));
        fs.closeSync(fd);
        fd = undefined;
        // linkSync is an atomic no-overwrite publish: EEXIST means another owner
        // already holds the canonical pathname.
        fs.linkSync(candidate, lockPath);
    }
    finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            }
            catch { /* best effort */ }
        }
        try {
            fs.unlinkSync(candidate);
        }
        catch { /* best effort */ }
    }
}
function sleepSync(ms) {
    if (ms <= 0)
        return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/**
 * Elect exactly one successor for a dead gate generation. Recovery claim files
 * are immutable and generation-tokened; they intentionally remain as tiny
 * tombstones so a delayed contender can never win the same recovery twice.
 * If a recovery owner itself dies, contenders extend the claim chain and one
 * successor is again elected atomically.
 */
function claimDeadGateGeneration(gatePath, deadGate, ownerPid, ownerFingerprint, isPidAlive, getProcessFingerprint, now) {
    let subjectPath = gatePath;
    let subject = deadGate;
    for (let depth = 0; depth < 16; depth += 1) {
        const claimPath = `${subjectPath}.recover.${subject.token}`;
        const timestamp = now();
        const claim = {
            version: 1,
            pid: ownerPid,
            token: crypto.randomUUID(),
            started_at: timestamp,
            heartbeat_at: timestamp,
            scan_type: 'acquisition-gate-recovery',
            owner_fingerprint: ownerFingerprint,
        };
        try {
            publishNewLease(claimPath, claim);
            return 'claimed';
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                return 'error';
            const existingClaim = readScanLease(claimPath);
            if (!existingClaim)
                return 'error';
            if (!canReclaim(existingClaim, isPidAlive, getProcessFingerprint))
                return 'wait';
            subjectPath = claimPath;
            subject = existingClaim;
        }
    }
    return 'error';
}
/**
 * Serialize the reclaim-and-publish critical section across processes.
 *
 * Every acquirer honors this short-lived gate, so a delayed stale reclaimer
 * cannot unlink a replacement lease. Dead gates are recovered through an
 * immutable generation-tokened claim election.
 */
function acquireAcquisitionGate(lockPath, ownerPid, ownerFingerprint, isPidAlive, getProcessFingerprint, now, waitMs, pollMs) {
    const gatePath = `${lockPath}.acquire`;
    const deadline = now() + waitMs;
    const token = crypto.randomUUID();
    const record = {
        version: 1,
        pid: ownerPid,
        token,
        started_at: now(),
        heartbeat_at: now(),
        scan_type: 'acquisition-gate',
        owner_fingerprint: ownerFingerprint,
    };
    while (true) {
        try {
            publishNewLease(gatePath, record);
            let released = false;
            let releaseRequested = false;
            let retryTimer;
            const attemptRelease = () => {
                if (released)
                    return;
                if (readScanLease(gatePath)?.token !== token) {
                    released = true;
                    return;
                }
                try {
                    fs.unlinkSync(gatePath);
                    if (readScanLease(gatePath)?.token === token) {
                        throw new Error('scan gate still present after release attempt');
                    }
                    released = true;
                    if (retryTimer)
                        clearTimeout(retryTimer);
                }
                catch {
                    retryTimer = setTimeout(() => {
                        retryTimer = undefined;
                        attemptRelease();
                    }, Math.max(1, pollMs));
                    retryTimer.unref();
                }
            };
            return {
                ok: true,
                release: () => {
                    if (released || releaseRequested)
                        return;
                    releaseRequested = true;
                    attemptRelease();
                },
            };
        }
        catch (error) {
            if (error.code !== 'EEXIST') {
                return { ok: false, message: `Could not acquire scan gate: ${error.message}` };
            }
            const existing = readScanLease(gatePath);
            if (!existing) {
                // EEXIST and this read are not one generation: the observed owner may
                // have released and a successor may already have published at the same
                // pathname. Never combine a failed read of the old generation with a
                // stat/read of the new one. Retry until one complete record is stable;
                // a permanently corrupt gate eventually becomes an operational timeout.
                if (now() >= deadline) {
                    return {
                        ok: false,
                        message: `Timed out waiting for a stable scan acquisition gate: ${gatePath}`,
                    };
                }
                sleepSync(pollMs);
                continue;
            }
            if (canReclaim(existing, isPidAlive, getProcessFingerprint)) {
                const recovery = claimDeadGateGeneration(gatePath, existing, ownerPid, ownerFingerprint, isPidAlive, getProcessFingerprint, now);
                if (recovery === 'error') {
                    return { ok: false, message: `Could not recover scan acquisition gate: ${gatePath}` };
                }
                if (recovery === 'claimed') {
                    // This recovery claim is the only successor authorized to remove the
                    // observed gate generation. Recheck its token before unlinking.
                    if (readScanLease(gatePath)?.token === existing.token) {
                        try {
                            fs.unlinkSync(gatePath);
                        }
                        catch { /* retry loop decides */ }
                    }
                }
                sleepSync(pollMs);
                continue;
            }
            if (now() >= deadline) {
                return {
                    ok: false,
                    message: `Timed out waiting for scan acquisition gate: ${gatePath}`,
                };
            }
            sleepSync(pollMs);
        }
    }
}
function removeIfStillReclaimable(lockPath, observed, now, ttlMs, isPidAlive, getProcessFingerprint, unlink) {
    const current = readScanLease(lockPath);
    if (observed && current?.token !== observed.token)
        return { status: 'not-reclaimable' };
    if (current && !canReclaim(current, isPidAlive, getProcessFingerprint)) {
        return { status: 'not-reclaimable' };
    }
    if (!current) {
        try {
            if (now - fs.statSync(lockPath).mtimeMs < ttlMs)
                return { status: 'not-reclaimable' };
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { status: 'removed' };
            return {
                status: 'error',
                message: `Could not inspect reclaimable scan lease: ${error.message}`,
            };
        }
    }
    try {
        unlink(lockPath);
        return { status: 'removed' };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { status: 'removed' };
        return {
            status: 'error',
            message: `Could not reclaim scan lease: ${error.message}`,
        };
    }
}
/**
 * Atomically acquire the scan lease at `lockPath`.
 *
 * A live owner returns a retryable contention result. A dead owner or old
 * corrupt record is recovered once; atomic publish decides any acquisition
 * race without exposing an empty canonical file.
 */
export function acquireScanLease(lockPath, scanType = 'unknown', options = {}) {
    const ttlMs = options.ttlMs ?? LOCK_TTL_MS;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    const nowFn = options.now ?? Date.now;
    const ownerPid = options.pid ?? process.pid;
    const ownerToken = options.token ?? crypto.randomUUID();
    const pidAlive = options.isPidAlive ?? defaultPidAlive;
    const processFingerprint = options.getProcessFingerprint ?? defaultProcessFingerprint;
    const ownerFingerprint = options.ownerFingerprint ?? processFingerprint(ownerPid) ?? undefined;
    const publishLease = options.publishLease ?? publishNewLease;
    const reclaimUnlink = options.reclaimUnlink ?? fs.unlinkSync;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const gate = acquireAcquisitionGate(lockPath, ownerPid, ownerFingerprint, pidAlive, processFingerprint, nowFn, options.gateWaitMs ?? 5000, options.gatePollMs ?? 2);
    if (!gate.ok) {
        return { ok: false, retryable: false, message: gate.message };
    }
    try {
        sleepSync(options.criticalSectionDelayMs ?? 0);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const now = nowFn();
            const record = {
                version: 1,
                pid: ownerPid,
                token: ownerToken,
                started_at: now,
                heartbeat_at: now,
                scan_type: scanType,
                owner_fingerprint: ownerFingerprint,
            };
            try {
                publishLease(lockPath, record);
            }
            catch (error) {
                const code = error.code;
                if (code !== 'EEXIST') {
                    return {
                        ok: false,
                        retryable: false,
                        message: `Could not acquire scan lease: ${error.message}`,
                    };
                }
                const existing = readScanLease(lockPath);
                if (existing && !canReclaim(existing, pidAlive, processFingerprint)) {
                    return { ok: false, retryable: true, message: formatContention(existing, now) };
                }
                if (attempt === 0) {
                    const reclaimed = removeIfStillReclaimable(lockPath, existing, now, ttlMs, pidAlive, processFingerprint, reclaimUnlink);
                    if (reclaimed.status === 'error') {
                        return { ok: false, retryable: false, message: reclaimed.message };
                    }
                    if (reclaimed.status === 'removed')
                        continue;
                }
                return {
                    ok: false,
                    retryable: true,
                    message: formatContention(readScanLease(lockPath), now),
                };
            }
            let released = false;
            let releaseRequested = false;
            let heartbeatTimer;
            let releaseRetryTimer;
            const heartbeat = () => {
                if (released)
                    return false;
                const current = readScanLease(lockPath);
                if (current?.token !== ownerToken)
                    return false;
                const refreshed = {
                    ...current,
                    heartbeat_at: nowFn(),
                };
                const candidate = `${lockPath}.heartbeat.${ownerToken}.${crypto.randomUUID()}`;
                try {
                    fs.writeFileSync(candidate, JSON.stringify(refreshed), { flag: 'wx' });
                    // Recheck after preparing the complete replacement. In-process timer
                    // callbacks and release are synchronous, so the owner cannot interleave
                    // its own release between this check and rename.
                    if (readScanLease(lockPath)?.token !== ownerToken)
                        return false;
                    fs.renameSync(candidate, lockPath);
                    return true;
                }
                catch {
                    return false;
                }
                finally {
                    try {
                        fs.unlinkSync(candidate);
                    }
                    catch { /* renamed or best effort */ }
                }
            };
            const finishRelease = () => {
                if (released)
                    return;
                released = true;
                if (heartbeatTimer)
                    clearInterval(heartbeatTimer);
                if (releaseRetryTimer)
                    clearTimeout(releaseRetryTimer);
            };
            const releaseRetryMs = options.releaseRetryMs ?? 100;
            const unlinkForRelease = options.releaseUnlink ?? fs.unlinkSync;
            const attemptRelease = () => {
                if (released)
                    return;
                const current = readScanLease(lockPath);
                if (current?.token !== ownerToken) {
                    finishRelease();
                    return;
                }
                try {
                    // A valid live-PID record cannot be reclaimed by another process, so
                    // no replacement owner can appear between this token check and unlink.
                    unlinkForRelease(lockPath);
                    if (readScanLease(lockPath)?.token === ownerToken) {
                        throw new Error('scan lease still present after release attempt');
                    }
                    finishRelease();
                }
                catch {
                    // Keep heartbeating while cleanup is retried. This prevents a transient
                    // unlink error from wedging a long-lived process with an abandoned lock.
                    releaseRetryTimer = setTimeout(() => {
                        releaseRetryTimer = undefined;
                        attemptRelease();
                    }, releaseRetryMs);
                    releaseRetryTimer.unref();
                }
            };
            const release = () => {
                if (released || releaseRequested)
                    return;
                releaseRequested = true;
                attemptRelease();
            };
            if (options.startHeartbeat !== false && heartbeatIntervalMs > 0) {
                heartbeatTimer = setInterval(heartbeat, heartbeatIntervalMs);
                heartbeatTimer.unref();
            }
            return {
                ok: true,
                lease: { lockPath, token: ownerToken, heartbeat, release },
            };
        }
        return {
            ok: false,
            retryable: true,
            message: 'Scan already in progress (acquisition race)',
        };
    }
    finally {
        gate.release();
    }
}
//# sourceMappingURL=scan-lock.js.map