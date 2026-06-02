/**
 * The freshness stamp: the honesty contract for the architecture view. Every
 * read can check this to know whether the view is current or how many files
 * have changed since the last clean drain. Cheaper and more robust than
 * guaranteeing freshness, especially under N parallel agents.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getGitInfo } from '../git.js';
import { stampPath } from './paths.js';
import { readDirty } from './dirty-ledger.js';
export function writeStamp(root, stamp) {
    const p = stampPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stamp, null, 2), 'utf8');
    fs.renameSync(tmp, p);
}
export function readStamp(root) {
    const p = stampPath(root);
    if (!fs.existsSync(p))
        return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed?.version === 1)
            return parsed;
    }
    catch {
        /* corrupt -> null */
    }
    return null;
}
/**
 * Compute a stamp for the current moment. `inFlight` marks a drain in progress;
 * `generatedAt` defaults to now (use the scan completion time on a clean drain).
 */
export async function computeStamp(root, opts = { inFlight: false }) {
    const git = await getGitInfo(root);
    const dirty = readDirty(root);
    return {
        version: 1,
        generated_at: opts.generatedAt ?? Date.now(),
        commit_sha: git?.commit ?? '',
        branch: git?.branch ?? '',
        dirty_files: dirty,
        dirty_count: dirty.length,
        scan_in_flight: opts.inFlight,
    };
}
//# sourceMappingURL=stamp.js.map