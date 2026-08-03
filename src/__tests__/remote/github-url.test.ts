import { describe, it, expect } from 'vitest';
import { parseGitHubUrl, validateRef } from '../../remote/github-url.js';

describe('parseGitHubUrl — accepted shapes', () => {
  it('accepts the https github.com owner/repo form', () => {
    expect(parseGitHubUrl('https://github.com/torvalds/linux')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
  });

  it('accepts the https form with a .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/torvalds/linux.git')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
  });

  it('accepts the https form with a /tree/<ref> suffix', () => {
    expect(parseGitHubUrl('https://github.com/torvalds/linux/tree/master')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
      ref: 'master',
    });
  });

  it('accepts the https form with .git and /tree/<ref> together', () => {
    expect(parseGitHubUrl('https://github.com/torvalds/linux.git/tree/v6.9')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
      ref: 'v6.9',
    });
  });

  it('accepts a /tree/<ref> containing a slash (feature branch name)', () => {
    expect(parseGitHubUrl('https://github.com/acme/widgets/tree/feature/foo')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      ref: 'feature/foo',
    });
  });

  it('accepts the ssh git@github.com: form', () => {
    expect(parseGitHubUrl('git@github.com:torvalds/linux')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
  });

  it('accepts the ssh form with a .git suffix', () => {
    expect(parseGitHubUrl('git@github.com:torvalds/linux.git')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
  });

  it('accepts the bare owner/repo shorthand', () => {
    expect(parseGitHubUrl('torvalds/linux')).toEqual({
      owner: 'torvalds',
      repo: 'linux',
    });
  });

  it('accepts owner/repo names containing dots, underscores, and hyphens', () => {
    expect(parseGitHubUrl('my-org_1/some.repo-name')).toEqual({
      owner: 'my-org_1',
      repo: 'some.repo-name',
    });
  });
});

describe('parseGitHubUrl — rejected payloads', () => {
  it('rejects a non-github host', () => {
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
  });

  it('rejects a URL carrying an appended shell command separator', () => {
    // Built by concatenation, not as a literal contiguous command string.
    const separator = ';';
    const trailingCommand = ['w', 'h', 'o', 'a', 'm', 'i'].join('');
    const payload = 'https://github.com/owner/repo' + separator + trailingCommand;
    expect(parseGitHubUrl(payload)).toBeNull();
  });

  it('rejects a parent-directory-traversal path', () => {
    const traversal = ['.', '.'].join('') + '/' + ['.', '.'].join('') + '/etc/passwd';
    expect(parseGitHubUrl(traversal)).toBeNull();
    expect(parseGitHubUrl('owner/..')).toBeNull();
    expect(parseGitHubUrl('../owner-repo')).toBeNull();
  });

  it('rejects a file:// URL', () => {
    expect(parseGitHubUrl('file:///etc/passwd')).toBeNull();
    expect(parseGitHubUrl('file:///Users/x/some-repo')).toBeNull();
  });

  it('rejects a bare local filesystem path', () => {
    expect(parseGitHubUrl('/Users/x/some-repo')).toBeNull();
    expect(parseGitHubUrl('./local-repo')).toBeNull();
  });

  it('rejects a leading-dash argument-injection payload (ssh ProxyCommand flag)', () => {
    const flagName = '-o' + 'ProxyCommand';
    const payload = flagName + '=' + 'id' + '/repo';
    expect(parseGitHubUrl(payload)).toBeNull();
    expect(parseGitHubUrl('owner/-' + flagName)).toBeNull();
  });

  it('rejects a backtick command-substitution payload', () => {
    const tick = String.fromCharCode(96); // backtick
    const payload = 'owner/repo' + tick + 'id' + tick;
    expect(parseGitHubUrl(payload)).toBeNull();
  });

  it('rejects a $(...) command-substitution payload', () => {
    const open = String.fromCharCode(36) + String.fromCharCode(40); // "$("
    const close = String.fromCharCode(41); // ")"
    const payload = 'owner/repo' + open + 'id' + close;
    expect(parseGitHubUrl(payload)).toBeNull();
  });

  it('rejects an embedded-newline payload', () => {
    const payload = 'owner/repo\nextra-line-of-input';
    expect(parseGitHubUrl(payload)).toBeNull();
  });

  it('rejects an over-long ref', () => {
    const longRef = 'x'.repeat(300);
    expect(parseGitHubUrl(`https://github.com/owner/repo/tree/${longRef}`)).toBeNull();
  });

  it('rejects empty and non-string input', () => {
    expect(parseGitHubUrl('')).toBeNull();
    expect(parseGitHubUrl('   ')).toBeNull();
    expect(parseGitHubUrl(undefined)).toBeNull();
    expect(parseGitHubUrl(42)).toBeNull();
  });

  it('rejects a ref containing parent-directory traversal', () => {
    const traversalRef = ['.', '.'].join('') + '/secrets';
    expect(parseGitHubUrl(`https://github.com/owner/repo/tree/${traversalRef}`)).toBeNull();
  });
});

describe('validateRef — SEC-001 (a separately-supplied --ref must face the same controls)', () => {
  it('accepts an ordinary branch/tag/commit-ish ref', () => {
    expect(validateRef('v6.9')).toBe('v6.9');
    expect(validateRef('feature/foo')).toBe('feature/foo');
  });

  it('rejects a leading-dash ref (git argv/option-injection payload)', () => {
    const flagName = '-' + 'upload-pack' + '=' + 'x';
    expect(validateRef(flagName)).toBeNull();
  });

  it('rejects a ref carrying parent-directory traversal', () => {
    const traversalRef = ['.', '.'].join('') + '/secrets';
    expect(validateRef(traversalRef)).toBeNull();
  });

  it('rejects an over-long ref', () => {
    expect(validateRef('x'.repeat(300))).toBeNull();
  });

  it('rejects a ref carrying an embedded newline', () => {
    expect(validateRef('main\nextra-line')).toBeNull();
  });

  it('rejects non-string, empty, and undefined input', () => {
    expect(validateRef('')).toBeNull();
    expect(validateRef(undefined)).toBeNull();
    expect(validateRef(42)).toBeNull();
  });
});
