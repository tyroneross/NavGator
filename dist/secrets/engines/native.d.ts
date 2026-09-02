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
import type { EngineCapability, SecretClass, SecretEngine, SecretFinding } from '../types.js';
/** sha256(value), first 12 hex chars. Per the frozen contract this is the ONLY
 * thing derived from a matched secret that is ever retained. */
export declare function sha256Hex12(value: string): string;
import { classifyCorpus } from '../corpus.js';
export { classifyCorpus };
/** First 12 characters of the matched text. Never the whole value. */
export declare function previewOf(value: string): string;
/** Recursively enumerates scannable files under each of `roots` (files pass
 * through as-is). Shared between NativeEngine.scan and scan.ts's
 * `filesScanned` count so both describe the same input surface. */
export declare function enumerateFiles(roots: string[]): string[];
export declare const NATIVE_CLASSES: SecretClass[];
export declare class NativeEngine implements SecretEngine {
    readonly id = "native";
    capability(): Promise<EngineCapability>;
    scan(paths: string[]): Promise<SecretFinding[]>;
}
//# sourceMappingURL=native.d.ts.map