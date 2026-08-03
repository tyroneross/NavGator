/**
 * Guard test for the suite-wide $HOME redirect (`src/__tests__/setup/home-redirect.ts`).
 *
 * This file proves the `setupFiles` hook is ACTIVE and not vacuous. It must
 * fail if someone deletes the `setupFiles` line from `vitest.config.ts`, or if
 * the hook silently stops redirecting. Without a test like this, the entire
 * C1 fix (stopping the suite from writing to the developer's real home) could
 * regress with nothing catching it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerProject } from '../projects.js';

describe('suite-wide home redirect', () => {
  it('publishes the real pre-redirect home as an absolute path', () => {
    const realHome = process.env.NAVGATOR_TEST_REAL_HOME;
    expect(realHome).toBeTruthy();
    expect(path.isAbsolute(realHome!)).toBe(true);
  });

  it('actually redirected os.homedir() away from the real home', () => {
    expect(os.homedir()).not.toBe(process.env.NAVGATOR_TEST_REAL_HOME);
  });

  it('redirected home lives inside os.tmpdir()', () => {
    // macOS resolves /tmp -> /var/folders/... via /var -> /private/var, so
    // compare realpaths or this assertion falsely fails on Darwin.
    const realTmp = fs.realpathSync(os.tmpdir());
    const realFakeHome = fs.realpathSync(os.homedir());
    expect(realFakeHome.startsWith(realTmp)).toBe(true);
  });

  it('NAVGATOR_HOME points inside the fake home', () => {
    const navHome = process.env.NAVGATOR_HOME;
    expect(navHome).toBeTruthy();
    const realFakeHome = fs.realpathSync(os.homedir());
    const realNavHome = fs.realpathSync(path.dirname(navHome!));
    expect(realNavHome).toBe(realFakeHome);
  });

  it('a real registry write reaches the fake home, never the real one', async () => {
    const marker = '/repos/home-isolation-guard';
    await registerProject(marker);

    const fakeRegistryPath = path.join(os.homedir(), '.navgator', 'projects.json');
    expect(fs.existsSync(fakeRegistryPath)).toBe(true);
    const fakeRegistry = JSON.parse(fs.readFileSync(fakeRegistryPath, 'utf-8'));
    expect(fakeRegistry.projects.some((p: { path: string }) => p.path === marker)).toBe(true);

    const realHome = process.env.NAVGATOR_TEST_REAL_HOME!;
    const realRegistryPath = path.join(realHome, '.navgator', 'projects.json');
    if (fs.existsSync(realRegistryPath)) {
      const realRegistry = JSON.parse(fs.readFileSync(realRegistryPath, 'utf-8'));
      expect(realRegistry.projects.some((p: { path: string }) => p.path === marker)).toBe(false);
    }
  });
});
