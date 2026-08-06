/**
 * deep-map ingest — turns `*.result.json` files into validated, attributed
 * findings.
 *
 * The CALLING agent (Claude Code, Codex, ...) fans an LLM out over the work
 * packets this engine emits and writes each answer to
 * `<run>/packets/<packet_id>.result.json`. This module is the only place that
 * reads those files, and its whole job is a security boundary: **model output
 * can never alter what tier 0 found.** Every byte of a result file is treated
 * as untrusted data, because the scanned repo may itself be someone else's
 * GitHub project (`navgator scan-remote`) — component names and file paths
 * inside a result file are then attacker-authored strings, not facts.
 *
 * The anti-hallucination join: a finding whose `component_id` does not exist
 * in tier 0's own component set is rejected and counted, never coerced into
 * existing, never silently dropped.
 *
 * No LLM SDK, no model call, no network — this only reads and validates files
 * already on disk.
 */
import * as fs from 'fs';
import { DEEP_MAP_LIMITS, DEEP_MAP_SCHEMA_VERSION, } from './types.js';
import { getPacketsPath, isContained, isValidPacketId, listPacketFiles, readPacket, resultPathFor, writeFindings, writeIngestReport, } from './store.js';
const DEEP_MAP_FINDING_KINDS = [
    'purpose',
    'responsibility',
    'concern',
    'inefficiency',
    'risk',
    'cross-cutting',
];
const RESULT_SUFFIX = '.result.json';
/** Strips every ASCII control char except tab, LF, CR — model text may legitimately contain those three. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
function sanitize(input) {
    return input.replace(CONTROL_CHARS_RE, '');
}
function truncate(input, max) {
    return input.length > max ? input.slice(0, max) : input;
}
/**
 * True when `evidence` is grounded in a real repo path: an exact match, or a
 * known path immediately followed by `:` or `#` (the `path:symbol` /
 * `path#symbol` form). Deliberately NOT an open-ended string-prefix match —
 * that would let any known path (e.g. a short root file like `a` or
 * `README.md`) ground arbitrary trailing text, defeating the
 * anti-hallucination guarantee this function exists to enforce.
 */
function isGroundedEvidence(evidence, knownFilePaths) {
    if (knownFilePaths.has(evidence))
        return true;
    const colonIdx = evidence.indexOf(':');
    if (colonIdx > 0 && knownFilePaths.has(evidence.slice(0, colonIdx)))
        return true;
    const hashIdx = evidence.indexOf('#');
    if (hashIdx > 0 && knownFilePaths.has(evidence.slice(0, hashIdx)))
        return true;
    return false;
}
function rejectFinding(packetId, index, reason, detail) {
    return { rejection: { packet_id: packetId, reason, detail: `finding[${index}]: ${detail}` } };
}
/**
 * Validate and sanitize one candidate finding. Returns either the finding to
 * keep or the rejection explaining why it was dropped — never both, never
 * neither.
 */
function validateOneFinding(entry, index, packet, packetComponentIds, options) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return rejectFinding(packet.packet_id, index, 'schema_violation', 'finding is not an object');
    }
    const f = entry;
    // The anti-hallucination join. A component_id absent from tier 0 is model
    // invention and must never become a finding.
    const componentId = f['component_id'];
    if (typeof componentId !== 'string' || !options.knownComponentIds.has(componentId)) {
        return rejectFinding(packet.packet_id, index, 'unknown_component', `component_id ${JSON.stringify(componentId)} was not found in the tier-0 scan`);
    }
    // Tier 1/2 packets scope a finding to the components they were actually
    // handed; tier 3 (cross-cutting) may name any known component.
    if (packet.tier !== 3 && !packetComponentIds.has(componentId)) {
        return rejectFinding(packet.packet_id, index, 'unknown_component', `component_id ${componentId} is real but outside packet ${packet.packet_id}'s scope (tier ${packet.tier})`);
    }
    const kind = f['kind'];
    if (typeof kind !== 'string' || !DEEP_MAP_FINDING_KINDS.includes(kind)) {
        return rejectFinding(packet.packet_id, index, 'schema_violation', `kind ${JSON.stringify(kind)} is not one of ${DEEP_MAP_FINDING_KINDS.join(', ')}`);
    }
    const rawText = f['text'];
    if (typeof rawText !== 'string' || rawText.length === 0) {
        return rejectFinding(packet.packet_id, index, 'schema_violation', 'text is missing, non-string, or empty');
    }
    const text = truncate(sanitize(rawText), DEEP_MAP_LIMITS.textLength);
    if (text.length === 0) {
        return rejectFinding(packet.packet_id, index, 'schema_violation', 'text is empty after sanitization');
    }
    const rawEvidence = f['evidence'];
    if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
        return rejectFinding(packet.packet_id, index, 'missing_evidence', 'evidence is missing, not an array, or empty');
    }
    const sanitizedEvidence = rawEvidence
        .filter((e) => typeof e === 'string' && e.length > 0)
        .slice(0, DEEP_MAP_LIMITS.evidencePerFinding)
        .map((e) => truncate(sanitize(e), DEEP_MAP_LIMITS.evidenceLength));
    if (sanitizedEvidence.length === 0) {
        return rejectFinding(packet.packet_id, index, 'missing_evidence', 'no evidence entry was a non-empty string');
    }
    if (!sanitizedEvidence.some((e) => isGroundedEvidence(e, options.knownFilePaths))) {
        return rejectFinding(packet.packet_id, index, 'missing_evidence', 'no evidence entry references a known repo file path');
    }
    const rawConfidence = f['confidence'];
    const confidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0.5;
    const rawModel = f['model'];
    const model = typeof rawModel === 'string' && rawModel.length > 0 ? truncate(sanitize(rawModel), 200) : undefined;
    const finding = {
        finding_id: `${packet.packet_id}_${index}`,
        run_id: packet.run_id,
        packet_id: packet.packet_id,
        tier: packet.tier,
        component_id: componentId,
        component_name: options.knownComponentIds.get(componentId) ?? componentId,
        kind: kind,
        text,
        evidence: sanitizedEvidence,
        confidence,
        source: 'llm',
        ingested_at: Date.now(),
        ...(model ? { model } : {}),
    };
    return { finding };
}
/**
 * Validate one packet's already-parsed result payload. Exported so validation
 * logic is directly testable without touching disk.
 */
export function validateResultPayload(raw, packet, options) {
    const findings = [];
    const rejections = [];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        rejections.push({
            packet_id: packet.packet_id,
            reason: 'schema_violation',
            detail: 'result payload is not an object',
        });
        return { findings, rejections };
    }
    const rawFindings = raw['findings'];
    if (!Array.isArray(rawFindings)) {
        rejections.push({
            packet_id: packet.packet_id,
            reason: 'schema_violation',
            detail: '"findings" is missing or not an array',
        });
        return { findings, rejections };
    }
    const overCap = rawFindings.length > DEEP_MAP_LIMITS.findingsPerPacket;
    const entries = overCap ? rawFindings.slice(0, DEEP_MAP_LIMITS.findingsPerPacket) : rawFindings;
    const packetComponentIds = new Set(packet.component_ids);
    entries.forEach((entry, index) => {
        const result = validateOneFinding(entry, index, packet, packetComponentIds, options);
        if ('rejection' in result)
            rejections.push(result.rejection);
        else
            findings.push(result.finding);
    });
    if (overCap) {
        rejections.push({
            packet_id: packet.packet_id,
            reason: 'too_many_findings',
            detail: `payload had ${rawFindings.length} findings; kept the first ${DEEP_MAP_LIMITS.findingsPerPacket}`,
        });
    }
    return { findings, rejections };
}
/**
 * Ingest every result file present for a run: validate, sanitize, attribute,
 * and (unless `persist: false`) write `findings.jsonl` + `ingest.json`.
 *
 * Walks the packets directory itself rather than only the dispatched-packet
 * list, so a `*.result.json` naming a packet id nobody dispatched is caught
 * as `unknown_packet` instead of silently ignored.
 */
export function ingestRun(options) {
    const persist = options.persist ?? true;
    const { runId, config, projectRoot } = options;
    const packetFiles = listPacketFiles(runId, config, projectRoot);
    const packetsById = new Map();
    for (const file of packetFiles) {
        const packet = readPacket(file);
        if (packet && packet.run_id === runId) {
            packetsById.set(packet.packet_id, packet);
        }
    }
    const packetsDir = getPacketsPath(runId, config, projectRoot);
    let entries;
    try {
        entries = fs.readdirSync(packetsDir);
    }
    catch {
        entries = [];
    }
    const resultFileNames = entries.filter((n) => n.endsWith(RESULT_SUFFIX)).sort();
    const findings = [];
    const rejections = [];
    let outputBytes = 0;
    let packetsWithResults = 0;
    for (const fileName of resultFileNames) {
        const candidateId = fileName.slice(0, -RESULT_SUFFIX.length);
        const packet = packetsById.get(candidateId);
        if (!packet || !isValidPacketId(candidateId)) {
            rejections.push({
                packet_id: candidateId,
                reason: 'unknown_packet',
                detail: `no dispatched packet ${JSON.stringify(candidateId)} exists in run ${runId}`,
            });
            continue;
        }
        const resolvedPath = resultPathFor(runId, candidateId, config, projectRoot);
        if (!resolvedPath || !isContained(packetsDir, resolvedPath)) {
            rejections.push({
                packet_id: candidateId,
                reason: 'path_escape',
                detail: 'result path resolved outside the run packets directory',
            });
            continue;
        }
        // lstat first, never statSync: statSync follows symlinks, and a
        // `<packet_id>.result.json` symlinked outside the run tree must be
        // rejected, not silently read through.
        let lstat;
        try {
            lstat = fs.lstatSync(resolvedPath);
        }
        catch {
            // Vanished between the directory listing and the stat — not countable, not an error.
            continue;
        }
        if (lstat.isSymbolicLink()) {
            rejections.push({
                packet_id: candidateId,
                reason: 'path_escape',
                detail: 'result path is a symlink; refusing to follow it',
            });
            continue;
        }
        // O_NOFOLLOW closes the TOCTOU window between the lstat above and this
        // open: if a symlink was substituted in between, the open itself fails
        // (ELOOP) rather than silently following it.
        let fd;
        try {
            fd = fs.openSync(resolvedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        }
        catch {
            rejections.push({
                packet_id: candidateId,
                reason: 'path_escape',
                detail: 'result path is a symlink; refusing to follow it',
            });
            continue;
        }
        try {
            // Every byte from here on is read from the descriptor we just opened —
            // never a re-resolution of the path — so the size cap and the parsed
            // content are guaranteed to describe the same file.
            const stat = fs.fstatSync(fd);
            packetsWithResults++;
            outputBytes += stat.size;
            if (stat.size > DEEP_MAP_LIMITS.resultBytes) {
                rejections.push({
                    packet_id: candidateId,
                    reason: 'oversized_result',
                    detail: `${stat.size} bytes exceeds the ${DEEP_MAP_LIMITS.resultBytes}-byte cap`,
                });
                continue;
            }
            const buffer = Buffer.alloc(Math.min(stat.size, DEEP_MAP_LIMITS.resultBytes));
            if (buffer.length > 0) {
                fs.readSync(fd, buffer, 0, buffer.length, 0);
            }
            let raw;
            try {
                raw = JSON.parse(buffer.toString('utf-8'));
            }
            catch {
                rejections.push({
                    packet_id: candidateId,
                    reason: 'malformed_json',
                    detail: 'result file is not valid JSON',
                });
                continue;
            }
            const validated = validateResultPayload(raw, { packet_id: packet.packet_id, tier: packet.tier, run_id: packet.run_id, component_ids: packet.component_ids }, { knownComponentIds: options.knownComponentIds, knownFilePaths: options.knownFilePaths });
            findings.push(...validated.findings);
            rejections.push(...validated.rejections);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    const report = {
        schema_version: DEEP_MAP_SCHEMA_VERSION,
        run_id: runId,
        ingested_at: Date.now(),
        packets_seen: packetsById.size,
        packets_with_results: packetsWithResults,
        accepted: findings.length,
        rejected: rejections.length,
        rejections,
        output_bytes: outputBytes,
    };
    if (persist) {
        writeFindings(runId, findings, config, projectRoot);
        writeIngestReport(report, config, projectRoot);
    }
    return { report, findings };
}
//# sourceMappingURL=ingest.js.map