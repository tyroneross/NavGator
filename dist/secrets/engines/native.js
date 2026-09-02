/**
 * NavGator's own deterministic regex engine. No external dependency, no LLM,
 * no network. Runs identically with or without a model available, per the
 * DETERMINISTIC CORE contract in `../types.ts`.
 *
 * Patterns are ported from two existing sources rather than invented fresh:
 *   - build-loop/scripts/security_scan.py (_PROVIDER_KEY_PATTERNS, _PEM_RE,
 *     _GENERIC_SECRET_RE)
 *   - secrets-vault SecretPatternMatcher.swift (specificPatterns, the
 *     high-entropy fallback and its Shannon-entropy gate)
 * plus new patterns for classes both of those sources miss on a real corpus:
 * postgres/mongodb/redis/jdbc URIs, npm, cloudflare, groq, openai, anthropic,
 * stripe, and a generic `scheme://user:pass@host` catch-all.
 *
 * This file also owns three small helpers reused by the sibling engine
 * adapters and by scan.ts (`classifyCorpus`, `sha256Hex12`, `previewOf`,
 * `enumerateFiles`) so corpus classification and the value-never-stored hash
 * boundary are implemented exactly once.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
// ---------------------------------------------------------------------------
// Shared helpers (also used by trufflehog.ts, vault.ts, scan.ts)
// ---------------------------------------------------------------------------
/** sha256(value), first 12 hex chars. Per the frozen contract this is the ONLY
 * thing derived from a matched secret that is ever retained. */
export function sha256Hex12(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}
import { classifyCorpus } from '../corpus.js';
export { classifyCorpus };
/** First 12 characters of the matched text. Never the whole value. */
export function previewOf(value) {
    return value.slice(0, 12);
}
// ---------------------------------------------------------------------------
// File enumeration (shared by NativeEngine.scan and scan.ts's filesScanned)
// ---------------------------------------------------------------------------
const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.navgator',
    '.venv', 'venv', '__pycache__', '.turbo', '.cache', 'out', 'vendor',
    '.build-loop',
]);
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|ico|bmp|svg|pdf|zip|gz|tar|tgz|bz2|7z|rar|woff2?|ttf|eot|otf|mp3|mp4|mov|avi|wasm|so|dll|dylib|exe|bin|class|jar|pyc|db|sqlite3?)$/i;
const LOCK_FILE_RE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — bound per-file read cost
const MAX_LINE_LEN = 4000; // longer than this = minified/bundled; skip file
/** True when the file at `filePath` is a plausible target for text scanning. */
function isScannableFile(filePath) {
    const base = path.basename(filePath);
    if (BINARY_EXT_RE.test(base) || LOCK_FILE_RE.test(base))
        return false;
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES)
            return false;
    }
    catch {
        return false;
    }
    return true;
}
/** Recursively enumerates scannable files under each of `roots` (files pass
 * through as-is). Shared between NativeEngine.scan and scan.ts's
 * `filesScanned` count so both describe the same input surface. */
export function enumerateFiles(roots) {
    const out = [];
    const seen = new Set();
    const visit = (entry) => {
        let stat;
        try {
            stat = fs.statSync(entry);
        }
        catch {
            return;
        }
        if (stat.isFile()) {
            if (isScannableFile(entry)) {
                const abs = path.resolve(entry);
                if (!seen.has(abs)) {
                    seen.add(abs);
                    out.push(abs);
                }
            }
            return;
        }
        if (!stat.isDirectory())
            return;
        if (IGNORED_DIRS.has(path.basename(entry)))
            return;
        let children;
        try {
            children = fs.readdirSync(entry, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const child of children) {
            visit(path.join(entry, child.name));
        }
    };
    for (const root of roots)
        visit(root);
    return out;
}
// Structured, fixed-prefix vendor formats — the highest-confidence tier.
// Ported from security_scan.py's _PROVIDER_KEY_PATTERNS + SecretPatternMatcher.swift,
// plus new entries for classes neither source covers.
const STRUCTURED_PATTERNS = [
    { id: 'aws_access_key_id', secretClass: 'aws_key', specificity: 'structured', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { id: 'github_classic_or_oauth_token', secretClass: 'github_token', specificity: 'structured', regex: /\bgh[pso]_[A-Za-z0-9]{36,}\b/g },
    { id: 'github_fine_grained_pat', secretClass: 'github_token', specificity: 'structured', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
    { id: 'gitlab_pat', secretClass: 'gitlab_token', specificity: 'structured', regex: /\bglpat-[A-Za-z0-9_\-]{20,}\b/g },
    { id: 'google_api_key', secretClass: 'google_api_key', specificity: 'structured', regex: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
    { id: 'slack_token', secretClass: 'slack_token', specificity: 'structured', regex: /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g },
    { id: 'anthropic_key', secretClass: 'anthropic_key', specificity: 'structured', regex: /\bsk-ant-[A-Za-z0-9_\-]{40,}\b/g },
    // Excludes sk-ant- so the more specific anthropic pattern above wins on that prefix.
    { id: 'openai_key', secretClass: 'openai_key', specificity: 'structured', regex: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}\b/g },
    { id: 'groq_key', secretClass: 'groq_key', specificity: 'structured', regex: /\bgsk_[A-Za-z0-9]{20,}\b/g },
    { id: 'stripe_key', secretClass: 'stripe_key', specificity: 'structured', regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
    { id: 'npm_token', secretClass: 'npm_token', specificity: 'structured', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
    { id: 'jwt', secretClass: 'jwt', specificity: 'structured', regex: /\bey[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
    { id: 'pem_private_key_header', secretClass: 'private_key', specificity: 'structured', regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
    { id: 'postgres_uri', secretClass: 'postgres_uri', specificity: 'structured', regex: /\bpostgres(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/g },
    { id: 'mongodb_uri', secretClass: 'mongodb_uri', specificity: 'structured', regex: /\bmongodb(?:\+srv)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/g },
    { id: 'redis_uri', secretClass: 'redis_uri', specificity: 'structured', regex: /\brediss?:\/\/[^\s'"]*:[^\s'"]+@[^\s'"]+/g },
    { id: 'jdbc_uri_userinfo', secretClass: 'jdbc_uri', specificity: 'structured', regex: /\bjdbc:[a-zA-Z0-9]+:\/\/[^\s'"]*?:[^\s'"]*?@[^\s'"]+/g },
    { id: 'jdbc_uri_query_credential', secretClass: 'jdbc_uri', specificity: 'structured', regex: /\bjdbc:[a-zA-Z0-9]+:\/\/[^\s'"]*?[?&;](?:user|password)=[^\s'"&;]+/g },
    { id: 'sendgrid_key', secretClass: 'sendgrid_key', specificity: 'structured', regex: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/g },
    // Deliberately no pattern for Twilio's "AC" Account SID, even though it shares
    // this exact shape (AC + 32 hex). The Account SID is a PUBLIC identifier per
    // Twilio's own docs, not a credential — matching it would manufacture false
    // positives on non-secret data. Only the "SK" API Key Secret is a real secret.
    { id: 'twilio_key', secretClass: 'twilio_key', specificity: 'structured', regex: /\bSK[0-9a-fA-F]{32}\b/g },
    // Matches the structural marker inside a GCP service-account JSON key file
    // rather than the PEM body it contains — the PEM is already caught by
    // pem_private_key_header above, and two patterns matching the same value
    // would fight each other in the overlap logic.
    { id: 'gcp_key', secretClass: 'gcp_key', specificity: 'structured', regex: /"type"\s*:\s*"service_account"/g },
    // Azure storage account keys are 88-char base64 ending in "==" — that shape
    // alone is far too generic (matches any base64 blob) and would flood the
    // scan, so anchor on the AccountKey/SharedAccessKey keyword the same way
    // Microsoft's own tooling detects it. Capture group isolates just the
    // secret material so the hash/preview aren't derived from the keyword text.
    { id: 'azure_key', secretClass: 'azure_key', specificity: 'structured', regex: /\b(?:AccountKey|SharedAccessKey)\s*=\s*([A-Za-z0-9+/]{86}==)/g, valueGroup: 1 },
];
// Keyword-assisted shapes — a match only because of a KEY=value assignment
// pattern, not a known vendor format. Honestly marked 'heuristic'.
const HEURISTIC_PATTERNS = [
    {
        id: 'cloudflare_token_assignment',
        secretClass: 'cloudflare_token',
        specificity: 'heuristic',
        regex: /\b(?:cloudflare|cf)[_-]?api[_-]?token\s*[=:]\s*["']?([A-Za-z0-9_\-]{40})["']?/gi,
        valueGroup: 1,
    },
    {
        id: 'generic_secret_assignment',
        secretClass: 'generic_assignment',
        specificity: 'heuristic',
        regex: /(?:^|[\s,({])(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|db[_-]?pass(?:word)?|database[_-]?pass(?:word)?|client[_-]?secret|webhook[_-]?secret|signing[_-]?secret|jwt[_-]?secret|session[_-]?secret|encryption[_-]?key)\s*[=:]\s*["']([^"']{8,})["']/gi,
        valueGroup: 1,
    },
    {
        // Catches `scheme://user:pass@host` for any scheme not already covered
        // above (postgres/mongodb/redis/jdbc). Broad by design — a shape match,
        // not a vendor format — hence 'heuristic' rather than 'structured'.
        id: 'generic_uri_credential',
        secretClass: 'generic_uri_credential',
        specificity: 'heuristic',
        regex: /\b(?!postgres(?:ql)?:\/\/|mongodb(?:\+srv)?:\/\/|rediss?:\/\/|jdbc:)[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^\s'"@/]+:[^\s'"@/]+@[^\s'"]+/g,
    },
];
const NATIVE_PATTERNS_IN_PRIORITY_ORDER = [...STRUCTURED_PATTERNS, ...HEURISTIC_PATTERNS];
export const NATIVE_CLASSES = Array.from(new Set([...NATIVE_PATTERNS_IN_PRIORITY_ORDER.map((p) => p.secretClass), 'high_entropy']));
// ---------------------------------------------------------------------------
// High-entropy fallback (ported from SecretPatternMatcher.swift
// isHighEntropyToken / shannonEntropy)
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTROPY_TOKEN_RE = /[A-Za-z0-9_\-+=/.]{24,200}/g;
function shannonEntropy(s) {
    if (s.length === 0)
        return 0;
    const counts = new Map();
    for (const ch of s)
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let h = 0;
    const n = s.length;
    for (const count of counts.values()) {
        const p = count / n;
        h -= p * Math.log2(p);
    }
    return h;
}
function looksHighEntropy(s) {
    if (s.length < 24 || s.length > 200)
        return false;
    if (s.includes('://') || s.startsWith('http'))
        return false;
    if (UUID_RE.test(s))
        return false;
    if ((s.match(/\./g) ?? []).length > 3)
        return false;
    const hasDigit = /[0-9]/.test(s);
    const hasLetter = /[A-Za-z]/.test(s);
    if (!hasDigit || !hasLetter)
        return false;
    return shannonEntropy(s) >= 3.2;
}
function overlapsAny(spans, start, end) {
    return spans.some(([s, e]) => start < e && end > s);
}
function findPatternMatches(line, pattern) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`);
    const out = [];
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(line)) !== null) {
        const groupIdx = pattern.valueGroup ?? 0;
        const value = m[groupIdx];
        if (value) {
            const start = groupIdx === 0 ? m.index : line.indexOf(value, m.index);
            if (start >= 0) {
                out.push({
                    start,
                    end: start + value.length,
                    value,
                    secretClass: pattern.secretClass,
                    specificity: pattern.specificity,
                    engineDetector: pattern.id,
                });
            }
        }
        if (m[0].length === 0)
            regex.lastIndex += 1;
    }
    return out;
}
function findHighEntropyMatches(line, consumed) {
    const out = [];
    let m;
    ENTROPY_TOKEN_RE.lastIndex = 0;
    while ((m = ENTROPY_TOKEN_RE.exec(line)) !== null) {
        const value = m[0];
        const start = m.index;
        const end = start + value.length;
        if (!overlapsAny(consumed, start, end) && looksHighEntropy(value)) {
            out.push({ start, end, value, secretClass: 'high_entropy', specificity: 'entropy', engineDetector: 'native_high_entropy_token' });
        }
    }
    return out;
}
function scanLine(line) {
    const consumed = [];
    const results = [];
    for (const pattern of NATIVE_PATTERNS_IN_PRIORITY_ORDER) {
        for (const match of findPatternMatches(line, pattern)) {
            if (overlapsAny(consumed, match.start, match.end))
                continue;
            results.push(match);
            consumed.push([match.start, match.end]);
        }
    }
    for (const match of findHighEntropyMatches(line, consumed)) {
        results.push(match);
        consumed.push([match.start, match.end]);
    }
    return results;
}
// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
function scanFile(filePath, byHash) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    }
    catch {
        return;
    }
    const lines = content.split(/\r?\n/);
    // Minified/bundled files produce phantom matches, not reviewable source —
    // same skip rule as security_scan.py's `_iter_lines`.
    if (lines.some((ln) => ln.length > MAX_LINE_LEN))
        return;
    const abs = path.resolve(filePath);
    const corpus = classifyCorpus(abs);
    lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        for (const match of scanLine(line)) {
            const hash = sha256Hex12(match.value);
            const location = { file: abs, line: lineNo, corpus };
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
                    preview: previewOf(match.value),
                    secretClass: match.secretClass,
                    specificity: match.specificity,
                    engine: 'native',
                    engineDetector: match.engineDetector,
                    locations: [location],
                    occurrences: 1,
                    liveness: 'unverified',
                    disposition: 'pending',
                });
            }
        }
    });
}
/** Pattern-set version. Not a vendor tool version — there is no binary to
 * query — but bumped whenever the pattern list changes so a doctor report can
 * distinguish scans run against different pattern sets. */
const NATIVE_PATTERN_SET_VERSION = '1.1.0';
export class NativeEngine {
    id = 'native';
    async capability() {
        return {
            id: this.id,
            available: true,
            version: NATIVE_PATTERN_SET_VERSION,
            classes: NATIVE_CLASSES,
            corpora: ['claude_transcripts', 'codex_transcripts', 'repo', 'other'],
            canVerifyLiveness: false,
        };
    }
    async scan(paths) {
        const byHash = new Map();
        for (const file of enumerateFiles(paths)) {
            scanFile(file, byHash);
        }
        return Array.from(byHash.values());
    }
}
//# sourceMappingURL=native.js.map