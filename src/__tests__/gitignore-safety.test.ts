import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ensureSafeGitignore } from '../gitignore-safety.js';

describe('ensureSafeGitignore', () => {
  let tmp: string;
  let gitignore: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-gitignore-test-'));
    gitignore = path.join(tmp, '.gitignore');
    delete process.env.NAVGATOR_SKIP_GITIGNORE_GUARD;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Swallow cleanup errors — temp dir on some systems resists removal
    }
  });

  it('returns no-gitignore when .gitignore is absent (does not create one)', async () => {
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('no-gitignore');
    expect(fs.existsSync(gitignore)).toBe(false);
  });

  it('appends the managed block when .gitignore exists but lacks the marker', async () => {
    fs.writeFileSync(gitignore, 'node_modules/\n.next/\n');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('added');
    const after = fs.readFileSync(gitignore, 'utf-8');
    expect(after).toContain('# >>> NavGator safety guard (auto-managed)');
    expect(after).toContain('.navgator/architecture/components/COMP_config_*.json');
    expect(after).toContain('.navgator/architecture/NAVSUMMARY.md');
    expect(after).toContain('.navgator/architecture/NAVSUMMARY_FULL.md');
    // Original content preserved
    expect(after).toContain('node_modules/');
    expect(after).toContain('.next/');
  });

  it('is idempotent: second call does not duplicate the block', async () => {
    fs.writeFileSync(gitignore, 'node_modules/\n');
    await ensureSafeGitignore(tmp);
    const afterFirst = fs.readFileSync(gitignore, 'utf-8');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('already-present');
    const afterSecond = fs.readFileSync(gitignore, 'utf-8');
    expect(afterSecond).toBe(afterFirst);
    // Only one marker occurrence
    const markerCount = (afterSecond.match(/# >>> NavGator safety guard/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it('skips when a broader rule already covers the guarded paths', async () => {
    fs.writeFileSync(gitignore, 'node_modules/\n.navgator/\n');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('already-present');
    const after = fs.readFileSync(gitignore, 'utf-8');
    expect(after).not.toContain('# >>> NavGator safety guard');
  });

  it('also detects .navgator/architecture/ as a broader covering rule', async () => {
    fs.writeFileSync(gitignore, '.navgator/architecture/\n');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('already-present');
  });

  it('respects NAVGATOR_SKIP_GITIGNORE_GUARD=1 opt-out', async () => {
    fs.writeFileSync(gitignore, 'node_modules/\n');
    process.env.NAVGATOR_SKIP_GITIGNORE_GUARD = '1';
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('opt-out');
    const after = fs.readFileSync(gitignore, 'utf-8');
    expect(after).not.toContain('# >>> NavGator safety guard');
  });

  it('does not re-add the block after a user deletes it (markers are load-bearing)', async () => {
    // Simulate a user who opted out by removing the markers but NavGator ran again
    fs.writeFileSync(gitignore, 'node_modules/\n');
    await ensureSafeGitignore(tmp);
    // User removes the managed block entirely
    const beforeDelete = fs.readFileSync(gitignore, 'utf-8');
    const withoutBlock = beforeDelete
      .split('\n')
      .filter((l) => !l.includes('NavGator safety guard') && !l.includes('.navgator/architecture/'))
      .join('\n');
    fs.writeFileSync(gitignore, withoutBlock);
    // But they also added their own rule (broader than needed) — the safety check respects it
    fs.appendFileSync(gitignore, '.navgator/\n');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('already-present');
    const finalContent = fs.readFileSync(gitignore, 'utf-8');
    // The managed marker is still absent — NavGator did not force it back
    expect(finalContent).not.toContain('# >>> NavGator safety guard');
  });

  it('adds trailing newline to gitignore that lacks one', async () => {
    fs.writeFileSync(gitignore, 'node_modules/'); // no trailing newline
    await ensureSafeGitignore(tmp);
    const after = fs.readFileSync(gitignore, 'utf-8');
    // Line before the managed block should be preserved, and the block
    // should not be glued onto the last content line
    expect(after).toMatch(/node_modules\/\n+# >>> NavGator safety guard/);
  });
});
