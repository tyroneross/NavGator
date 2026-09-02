/**
 * Adapter over Secrets Vault's own transcript audit
 * (`vault audit-transcripts --dry-run --json`).
 *
 * Verified against the live CLI today (`vault audit-transcripts --help`):
 *
 *   vault audit-transcripts [--days <n>] [--auto-create] [--store-values] [--dry-run] [--json]
 *
 * `--days <n>` looks back n days (default scans all history). Metadata-only
 * by default (kind, <=12-char preview, SHA-256 hash) — `--dry-run` additionally
 * guarantees nothing is written, matching NavGator's own never-store-values
 * rule.
 *
 * CONTRACT MISMATCH (documented, not silently worked around):
 *   `vault audit-transcripts` takes NO path argument. It always scans its own
 *   fixed corpus, `~/.claude/projects/*\/*.jsonl`, directly against the
 *   locally running vault daemon/app over HTTP. The frozen SecretEngine
 *   interface passes `paths: string[]` uniformly to every engine, but vault
 *   cannot be pointed at an arbitrary directory — there is no way to scope it
 *   to a test fixture. This adapter therefore only invokes the real CLI when
 *   the caller's `paths` actually include (or are) `~/.claude/projects`; for
 *   any other input it returns `[]` without shelling out, so a scan over a
 *   temp fixture directory can never accidentally read the user's real
 *   transcripts.
 *
 *   A second gap: `vault audit-transcripts --json`'s `TranscriptFinding`
 *   carries `projectDir` (the encoded directory under `~/.claude/projects/`)
 *   and NOT the individual `.jsonl` file or line number a secret appeared on.
 *   `SecretLocation.file` is therefore set to the project's transcript
 *   directory, not a single file — coarser than what native/trufflehog can
 *   report. `SecretLocation.line` is omitted (left undefined) for every vault
 *   finding for the same reason.
 *
 * Also verified today: `vault audit-transcripts` requires the vault
 * daemon/app to be running and unlocked (it makes an HTTP call). If it is
 * not, the process fails — treated here as `available:false` for scan(),
 * and scan() itself falls back to `[]` on any invocation error rather than
 * throwing.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { classifyCorpus } from './native.js';
const execFileAsync = promisify(execFile);
/** vault's own `SecretKind` union (secret-patterns.ts), mapped into ours. */
const KIND_MAP = {
    anthropic: 'anthropic_key',
    openai: 'openai_key',
    github_classic: 'github_token',
    github_pat: 'github_token',
    github_oauth: 'github_token',
    aws_access_key: 'aws_key',
    pem: 'private_key',
    jwt: 'jwt',
    generic: 'generic_assignment',
};
// vault does NOT cover postgres, npm, cloudflare, mongodb, or groq — declared
// honestly here rather than over-claiming, since an over-claimed capability
// would silently hide a real coverage gap (the doctor's `uncovered_class`
// diagnostic depends on this being accurate).
const VAULT_CLASSES = Array.from(new Set(Object.values(KIND_MAP)));
function defaultBinaryPath() {
    return path.join(os.homedir(), '.local', 'bin', 'vault');
}
export class VaultEngine {
    opts;
    id = 'vault';
    constructor(opts = {}) {
        this.opts = opts;
    }
    resolveBinary() {
        const binaryPath = this.opts.binaryPath ?? defaultBinaryPath();
        return existsSync(binaryPath) ? binaryPath : null;
    }
    async capability() {
        const corpora = ['claude_transcripts'];
        const binary = this.resolveBinary();
        if (!binary) {
            return {
                id: this.id,
                available: false,
                unavailableReason: `vault binary not found at ${this.opts.binaryPath ?? defaultBinaryPath()}`,
                classes: VAULT_CLASSES,
                corpora,
                canVerifyLiveness: false,
            };
        }
        return {
            id: this.id,
            available: true,
            classes: VAULT_CLASSES,
            corpora,
            canVerifyLiveness: false,
        };
    }
    async scan(paths) {
        const binary = this.resolveBinary();
        if (!binary)
            return [];
        const claudeProjectsRoot = path.join(os.homedir(), '.claude', 'projects');
        const requestsRealCorpus = paths.some((p) => {
            const abs = path.resolve(p);
            return abs === claudeProjectsRoot || abs.startsWith(claudeProjectsRoot + path.sep) || claudeProjectsRoot.startsWith(abs + path.sep);
        });
        // vault ignores `paths` entirely (see file header) — we only ever shell
        // out when the request could plausibly mean "scan the real transcripts".
        if (!requestsRealCorpus)
            return [];
        const args = ['audit-transcripts', '--dry-run', '--json'];
        if (this.opts.days !== undefined)
            args.splice(1, 0, '--days', String(this.opts.days));
        let stdout;
        try {
            const result = await execFileAsync(binary, args, { maxBuffer: 64 * 1024 * 1024 });
            stdout = result.stdout;
        }
        catch {
            // Daemon not running/unlocked, or any other invocation failure — the
            // deterministic core must keep going with whatever engines are healthy.
            return [];
        }
        let parsed;
        try {
            parsed = JSON.parse(stdout);
        }
        catch {
            return [];
        }
        const byHash = new Map();
        for (const f of parsed.preview ?? []) {
            if (!f.kind || !f.valueHash || !f.preview)
                continue;
            const mappedClass = KIND_MAP[f.kind];
            const secretClass = mappedClass ?? 'unknown';
            const specificity = !mappedClass ? 'entropy' : f.kind === 'generic' ? 'heuristic' : 'structured';
            const projectDir = f.projectDir ?? 'unknown-project';
            const file = path.join(claudeProjectsRoot, projectDir);
            const location = { file, corpus: classifyCorpus(file) };
            const occurrences = typeof f.occurrences === 'number' ? f.occurrences : 1;
            const existing = byHash.get(f.valueHash);
            if (existing) {
                const dup = existing.locations.some((l) => l.file === location.file && l.line === location.line);
                if (!dup)
                    existing.locations.push(location);
                existing.occurrences += occurrences;
                if (f.firstSeenAt && (!existing.firstSeen || f.firstSeenAt < existing.firstSeen))
                    existing.firstSeen = f.firstSeenAt;
                if (f.lastSeenAt && (!existing.lastSeen || f.lastSeenAt > existing.lastSeen))
                    existing.lastSeen = f.lastSeenAt;
            }
            else {
                byHash.set(f.valueHash, {
                    hash: f.valueHash,
                    preview: f.preview.slice(0, 12),
                    secretClass,
                    specificity,
                    engine: this.id,
                    engineDetector: f.kind,
                    locations: [location],
                    occurrences,
                    firstSeen: f.firstSeenAt,
                    lastSeen: f.lastSeenAt,
                    liveness: 'unverified',
                    disposition: 'pending',
                });
            }
        }
        return Array.from(byHash.values());
    }
}
//# sourceMappingURL=vault.js.map