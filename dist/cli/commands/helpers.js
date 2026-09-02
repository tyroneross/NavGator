import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
/**
 * Resolve the git repository root for `from`, or null when `from` is not
 * inside a git working tree. `.git` is a directory in a normal clone and a
 * file in a worktree/submodule, so test for existence, not for a directory.
 */
function real(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return p;
    }
}
function findGitRoot(from) {
    let dir = from;
    const root = path.parse(dir).root;
    while (dir !== root) {
        if (fs.existsSync(path.join(dir, '.git')))
            return dir;
        dir = path.dirname(dir);
    }
    return null;
}
/**
 * Check if NavGator data exists in the current directory or parent directories.
 * Traverses upward like git does to find the project root.
 * Returns a warning message if not found, or null if data exists.
 *
 * The upward walk stops at the git repository root. A `.navgator/` above that
 * root belongs to a DIFFERENT project, and adopting it would silently answer
 * questions about the wrong graph — the failure mode this guard exists to
 * prevent is an unscanned repo resolving to a home-directory-wide index.
 */
export function checkDataAvailability() {
    const startCwd = process.cwd();
    const root = path.parse(startCwd).root;
    const gitRoot = findGitRoot(startCwd);
    const home = os.homedir();
    let dir = startCwd;
    while (dir !== root) {
        const navDir = path.join(dir, '.navgator', 'architecture');
        if (fs.existsSync(navDir)) {
            const indexPath = path.join(navDir, 'index.json');
            if (!fs.existsSync(indexPath)) {
                return `NavGator data incomplete in ${dir}. Run \`navgator scan\` to rebuild.`;
            }
            if (dir !== startCwd) {
                // Never adopt a home-directory-wide index on behalf of a project that
                // merely lives underneath it.
                if (real(dir) === real(home)) {
                    return (`No NavGator data for ${startCwd}.\n` +
                        `Run \`navgator scan\` here first.\n` +
                        `Refusing to answer from the home-directory index at ${home}.`);
                }
                // Retargeting is only legitimate inside the same project. Announce it
                // on stderr so --json/--agent stdout stays machine-parseable.
                process.stderr.write(`NavGator: using the project graph at ${dir} (you are in ${startCwd}).\n`);
                process.chdir(dir);
            }
            return null;
        }
        // Do not walk out of the current repository.
        if (gitRoot && dir === gitRoot) {
            return (`No NavGator data for this repository (${gitRoot}).\n` +
                `Run \`navgator scan\` here first.\n` +
                `Refusing to answer from a graph outside this repository.`);
        }
        dir = path.dirname(dir);
    }
    return `No NavGator project found.\nRun \`navgator scan\` in your project root, or \`navgator projects\` to find scanned projects.`;
}
//# sourceMappingURL=helpers.js.map