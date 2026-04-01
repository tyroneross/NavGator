import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if NavGator data exists in the current directory.
 * Returns a warning message if not found, or null if data exists.
 */
export function checkDataAvailability(): string | null {
  const cwd = process.cwd();
  const navDir = path.join(cwd, '.navgator', 'architecture');
  if (!fs.existsSync(navDir)) {
    return `No NavGator data in ${cwd}.\nRun \`navgator scan\` first, or \`navgator projects\` to find scanned projects.`;
  }
  const indexPath = path.join(navDir, 'index.json');
  if (!fs.existsSync(indexPath)) {
    return `NavGator data incomplete in ${cwd}. Run \`navgator scan\` to rebuild.`;
  }
  return null;
}
