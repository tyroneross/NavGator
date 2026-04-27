import * as fs from 'fs';
import * as path from 'path';
/**
 * Check if NavGator data exists in the current directory or parent directories.
 * Traverses upward like git does to find the project root.
 * Returns a warning message if not found, or null if data exists.
 */
export function checkDataAvailability() {
    let dir = process.cwd();
    const root = path.parse(dir).root;
    // Walk up the directory tree looking for .navgator/
    while (dir !== root) {
        const navDir = path.join(dir, '.navgator', 'architecture');
        if (fs.existsSync(navDir)) {
            const indexPath = path.join(navDir, 'index.json');
            if (!fs.existsSync(indexPath)) {
                return `NavGator data incomplete in ${dir}. Run \`navgator scan\` to rebuild.`;
            }
            // Found it — if it's not in CWD, tell the user
            if (dir !== process.cwd()) {
                // Change CWD to the project root so commands work
                process.chdir(dir);
            }
            return null;
        }
        dir = path.dirname(dir);
    }
    return `No NavGator project found.\nRun \`navgator scan\` in your project root, or \`navgator projects\` to find scanned projects.`;
}
//# sourceMappingURL=helpers.js.map