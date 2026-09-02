/**
 * The single definition of "which corpus does this path belong to".
 *
 * WHY THIS IS ITS OWN MODULE. Two consumers need this rule: the engines, which
 * label each finding's location, and the doctor, which classifies `scannedPaths`
 * for its blind-spot check. Written separately, they disagreed — one resolved the
 * path and checked for a git root, the other matched strings and defaulted
 * unknown paths to 'repo'. `/tmp/scratch/foo` came out 'other' in one and 'repo'
 * in the other, which would let the doctor report a blind spot against a corpus
 * the findings themselves were labelled differently from. A closed enum whose
 * derivation lives in two places is a contract with two meanings.
 *
 * The transcript roots are matched by resolved prefix, not substring: a repo
 * that happens to contain the characters `.claude/projects` in a path is not a
 * Claude transcript corpus.
 */
import type { SecretLocation } from './types.js';
export declare const CLAUDE_PROJECTS_ROOT: string;
export declare const CODEX_SESSIONS_ROOT: string;
/**
 * Classify a path into the closed corpus enum.
 *
 * Drives the doctor's blind-spot check: Secrets Vault only ever reads
 * `claude_transcripts`, so anything under `codex_transcripts` proves that engine
 * could never have seen it.
 *
 * Touches the filesystem to tell 'repo' from 'other'. That makes the answer
 * environment-dependent, which is the correct trade: a path either is inside a
 * git repo or it is not, and guessing from the string gets it wrong. Determinism
 * still holds for a given machine state, which is what the scan contract needs.
 */
export declare function classifyCorpus(filePath: string): SecretLocation['corpus'];
//# sourceMappingURL=corpus.d.ts.map