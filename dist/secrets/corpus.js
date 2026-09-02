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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
export const CODEX_SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');
/** Walk up looking for a `.git` entry, stopping at the filesystem root. */
function isInsideGitRepo(startDir) {
    let dir = path.resolve(startDir);
    for (;;) {
        if (fs.existsSync(path.join(dir, '.git')))
            return true;
        const parent = path.dirname(dir);
        if (parent === dir)
            return false;
        dir = parent;
    }
}
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
export function classifyCorpus(filePath) {
    const abs = path.resolve(filePath);
    if (abs === CLAUDE_PROJECTS_ROOT || abs.startsWith(CLAUDE_PROJECTS_ROOT + path.sep)) {
        return 'claude_transcripts';
    }
    if (abs === CODEX_SESSIONS_ROOT || abs.startsWith(CODEX_SESSIONS_ROOT + path.sep)) {
        return 'codex_transcripts';
    }
    let dir;
    try {
        dir = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    }
    catch {
        dir = path.dirname(abs);
    }
    return isInsideGitRepo(dir) ? 'repo' : 'other';
}
//# sourceMappingURL=corpus.js.map