const fs = require('fs');
const path = require('path');
const os = require('os');

const pluginDir = path.join(os.homedir(), '.claude', 'plugins');
const linkPath = path.join(pluginDir, 'navgator');
const packageRoot = path.resolve(__dirname, '..');

// Only link if .claude directory exists (user has Claude Code)
if (fs.existsSync(path.join(os.homedir(), '.claude'))) {
  fs.mkdirSync(pluginDir, { recursive: true });

  // Remove existing link if stale
  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing !== packageRoot) fs.unlinkSync(linkPath);
  } catch {}

  if (!fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(packageRoot, linkPath, 'dir');
      console.log('\n\u{1F40A} NavGator plugin linked to Claude Code');
      console.log(`   ${linkPath} -> ${packageRoot}\n`);
    } catch (err) {
      console.log('\n\u{1F40A} NavGator installed but could not auto-link plugin.');
      console.log('   Link manually:');
      console.log(`   ln -s ${packageRoot} ${linkPath}\n`);
    }
  } else {
    console.log('\n\u{1F40A} NavGator plugin already linked. Run: navgator setup\n');
  }
} else {
  console.log('\n\u{1F40A} NavGator installed! Run: navgator setup');
  console.log('   (Claude Code not detected - plugin not auto-linked)\n');
}
