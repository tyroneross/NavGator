/**
 * Adapter over the `trufflehog` binary (https://github.com/trufflesecurity/trufflehog).
 *
 * Detected at /opt/homebrew/bin/trufflehog first, then `trufflehog` on PATH.
 * Never auto-installed: if neither resolves, capability() reports
 * available:false and scan() returns [] rather than throwing.
 *
 * TruffleHog ships hundreds of detectors. Only a fixed set map to a
 * `SecretClass` here; everything else — the long tail of generic-entropy
 * detectors (Refiner, Box, TLy, Fmfw, RailwayApp, Aiven, Sirv, Qase, Wit,
 * UnifyID, Juro, Imagga, and more) that fire on any UUID, git SHA, or base64
 * blob in a coding corpus — is classified `unknown` / `entropy` and preserved
 * verbatim via `engineDetector`, never silently dropped. That preserved name
 * is what lets the doctor report an `unmapped_class` diagnostic instead of
 * quietly losing the signal.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { classifyCorpus, previewOf, sha256Hex12 } from './native.js';
const execFileAsync = promisify(execFile);
const DEFAULT_ABSOLUTE_CANDIDATE = '/opt/homebrew/bin/trufflehog';
const PATH_CANDIDATE = 'trufflehog';
/** Confirmed structured detectors, observed in practice on a real 14GB
 * corpus (209 of 12,601 total hits). Everything not listed here maps to
 * 'unknown' with specificity 'entropy'. */
const DETECTOR_MAP = {
    GitHubOauth2: 'github_token',
    OpenAI: 'openai_key',
    CloudflareApiToken: 'cloudflare_token',
    Groq: 'groq_key',
    NpmToken: 'npm_token',
    Postgres: 'postgres_uri',
    URI: 'generic_uri_credential',
    AWS: 'aws_key',
    Slack: 'slack_token',
    SendGrid: 'sendgrid_key',
    Stripe: 'stripe_key',
    Twilio: 'twilio_key',
    Anthropic: 'anthropic_key',
    GCP: 'gcp_key',
    PrivateKey: 'private_key',
    JDBC: 'jdbc_uri',
    MongoDB: 'mongodb_uri',
};
const TRUFFLEHOG_CLASSES = Array.from(new Set([...Object.values(DETECTOR_MAP), 'unknown']));
/**
 * Pure mapping from a TruffleHog `DetectorName` to our SecretClass +
 * specificity. Exported (and used by `scan()` above) so the "unmapped
 * detector -> unknown/entropy, never dropped" behavior is directly testable
 * without shelling out to the trufflehog binary.
 */
export function mapDetectorName(detectorName) {
    const mappedClass = DETECTOR_MAP[detectorName];
    if (mappedClass)
        return { secretClass: mappedClass, specificity: 'structured' };
    return { secretClass: 'unknown', specificity: 'entropy' };
}
export class TruffleHogEngine {
    opts;
    id = 'trufflehog';
    resolved; // undefined = not yet resolved, null = confirmed absent
    constructor(opts = {}) {
        this.opts = opts;
    }
    async resolveBinary() {
        if (this.resolved !== undefined)
            return this.resolved;
        const candidates = this.opts.binaryPath ? [this.opts.binaryPath] : [DEFAULT_ABSOLUTE_CANDIDATE, PATH_CANDIDATE];
        for (const candidate of candidates) {
            if (path.isAbsolute(candidate)) {
                if (existsSync(candidate)) {
                    this.resolved = candidate;
                    return candidate;
                }
                continue;
            }
            try {
                await execFileAsync(candidate, ['--version']);
                this.resolved = candidate;
                return candidate;
            }
            catch {
                // not on PATH — try next candidate
            }
        }
        this.resolved = null;
        return null;
    }
    async capability() {
        const corpora = ['claude_transcripts', 'codex_transcripts', 'repo', 'other'];
        const binary = await this.resolveBinary();
        if (!binary) {
            return {
                id: this.id,
                available: false,
                unavailableReason: `trufflehog binary not found at ${DEFAULT_ABSOLUTE_CANDIDATE} or on PATH`,
                classes: TRUFFLEHOG_CLASSES,
                corpora,
                // It has a verification mode even though we never invoke it with one.
                canVerifyLiveness: true,
            };
        }
        let version;
        try {
            const { stdout } = await execFileAsync(binary, ['--version']);
            version = stdout.trim().split('\n')[0] || undefined;
        }
        catch {
            version = undefined;
        }
        return {
            id: this.id,
            available: true,
            version,
            classes: TRUFFLEHOG_CLASSES,
            corpora,
            canVerifyLiveness: true,
        };
    }
    async scan(paths) {
        if (paths.length === 0)
            return [];
        const binary = await this.resolveBinary();
        if (!binary)
            return [];
        const args = ['filesystem', ...paths, '--no-verification', '--json', '--no-update'];
        const lines = await runAndCollectLines(binary, args);
        const byHash = new Map();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            let obj;
            try {
                obj = JSON.parse(trimmed);
            }
            catch {
                continue;
            }
            const detectorName = obj.DetectorName;
            const raw = obj.Raw;
            const file = obj.SourceMetadata?.Data?.Filesystem?.file;
            if (!detectorName || !raw || !file)
                continue;
            const { secretClass, specificity } = mapDetectorName(detectorName);
            const hash = sha256Hex12(raw);
            const absFile = path.resolve(file);
            const location = {
                file: absFile,
                line: obj.SourceMetadata?.Data?.Filesystem?.line,
                corpus: classifyCorpus(absFile),
            };
            const existing = byHash.get(hash);
            if (existing) {
                const dup = existing.locations.some((l) => l.file === location.file && l.line === location.line);
                if (!dup)
                    existing.locations.push(location);
                existing.occurrences += 1;
            }
            else {
                byHash.set(hash, {
                    hash,
                    preview: previewOf(raw),
                    secretClass,
                    specificity,
                    engine: this.id,
                    // Original detector name preserved verbatim, mapped or not — this is
                    // what lets the doctor surface unmapped classes instead of losing them.
                    engineDetector: detectorName,
                    locations: [location],
                    occurrences: 1,
                    liveness: 'unverified',
                    disposition: 'pending',
                });
            }
        }
        return Array.from(byHash.values());
    }
}
function runAndCollectLines(binary, args) {
    return new Promise((resolve) => {
        const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const lines = [];
        let buffer = '';
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let idx = buffer.indexOf('\n');
            while (idx >= 0) {
                lines.push(buffer.slice(0, idx));
                buffer = buffer.slice(idx + 1);
                idx = buffer.indexOf('\n');
            }
        });
        child.stderr.on('data', () => {
            // TruffleHog logs progress/errors to stderr; irrelevant to JSON parsing.
        });
        // Spawn failure (e.g. binary vanished between resolveBinary and here) —
        // degrade to no findings rather than throwing.
        child.on('error', () => resolve(lines));
        child.on('close', () => {
            if (buffer.trim().length > 0)
                lines.push(buffer);
            resolve(lines);
        });
    });
}
//# sourceMappingURL=trufflehog.js.map