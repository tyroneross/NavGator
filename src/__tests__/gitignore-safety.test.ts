import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { ensureSafeGitignore } from '../gitignore-safety.js';
import { runMarkDirty } from '../cli/commands/freshness.js';

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
    expect(after).toContain('.navgator/dirty.d/');
    expect(after).toContain('.navgator/dirty.lock*');
    expect(after).toContain('.navgator/scan.lock*');
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

  it('adds freshness ignores when only architecture output is already ignored', async () => {
    fs.writeFileSync(gitignore, '.navgator/architecture/\n');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('added');
    expect(fs.readFileSync(gitignore, 'utf8')).toContain('.navgator/dirty.d/');
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

  // f1: components.full.jsonl and connections.full.jsonl carry the same
  // env-hostname data as COMP_config_*.json but were absent from GUARDED_PATTERNS.
  it('guards components.full.jsonl and connections.full.jsonl in the managed block', async () => {
    fs.writeFileSync(gitignore, 'node_modules/\n');
    const result = await ensureSafeGitignore(tmp);
    expect(result.action).toBe('added');
    const after = fs.readFileSync(gitignore, 'utf-8');
    expect(after).toContain('.navgator/architecture/components.full.jsonl');
    expect(after).toContain('.navgator/architecture/connections.full.jsonl');
  });

  it('upgrades an older managed block with freshness and lease patterns', async () => {
    fs.writeFileSync(gitignore, [
      '# existing',
      '# >>> NavGator safety guard (auto-managed)',
      '.navgator/architecture/NAVSUMMARY.md',
      '# <<< NavGator safety guard',
      '# trailing',
      '',
    ].join('\n'));

    const result = await ensureSafeGitignore(tmp);
    const after = fs.readFileSync(gitignore, 'utf8');
    expect(result.action).toBe('updated');
    expect(after).toContain('.navgator/dirty.d/');
    expect(after).toContain('.navgator/scan.lock*');
    expect(after).toContain('# existing');
    expect(after).toContain('# trailing');
  });

  it('keeps a fresh Git worktree clean after mark-dirty without creating .gitignore', async () => {
    execFileSync('git', ['init', '-q', tmp]);
    await runMarkDirty(['src/secret.ts'], tmp);

    expect(fs.existsSync(gitignore)).toBe(false);
    expect(execFileSync('git', ['-C', tmp, 'status', '--short'], { encoding: 'utf8' })).toBe('');
    const exclude = execFileSync(
      'git',
      ['-C', tmp, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
      { encoding: 'utf8' },
    ).trim();
    expect(fs.readFileSync(exclude, 'utf8')).toContain('.navgator/dirty.d/');
  });
});
