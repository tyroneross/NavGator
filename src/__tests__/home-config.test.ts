/**
 * `src/home-config.ts` — loader for `~/.navgator/config.json`.
 *
 * Redirects `$HOME` to a fresh `mkdtemp` directory per test, because
 * `homeConfigPath()` resolves through `os.homedir()` at call time and this
 * suite needs a fresh, empty home for the "absent file" case to actually mean
 * "absent" rather than accidentally picking up a previous test's file (or the
 * developer's real config).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadHomeConfig, homeConfigPath, resetHomeConfigCache } from '../home-config.js';

let homeDir: string;
let prevHome: string | undefined;
let prevMemory: string | undefined;
let prevMirror: string | undefined;
let prevMirrorTarget: string | undefined;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-home-config-'));
  prevHome = process.env.HOME;
  process.env.HOME = homeDir;

  prevMemory = process.env.NAVGATOR_MEMORY;
  prevMirror = process.env.NAVGATOR_MEMORY_MIRROR;
  prevMirrorTarget = process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
  delete process.env.NAVGATOR_MEMORY;
  delete process.env.NAVGATOR_MEMORY_MIRROR;
  delete process.env.NAVGATOR_MEMORY_MIRROR_TARGET;

  resetHomeConfigCache();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;

  if (prevMemory === undefined) delete process.env.NAVGATOR_MEMORY;
  else process.env.NAVGATOR_MEMORY = prevMemory;

  if (prevMirror === undefined) delete process.env.NAVGATOR_MEMORY_MIRROR;
  else process.env.NAVGATOR_MEMORY_MIRROR = prevMirror;

  if (prevMirrorTarget === undefined) delete process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
  else process.env.NAVGATOR_MEMORY_MIRROR_TARGET = prevMirrorTarget;

  resetHomeConfigCache();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe('homeConfigPath', () => {
  it('resolves under the redirected home, per call', () => {
    expect(homeConfigPath()).toBe(path.join(homeDir, '.navgator', 'config.json'));
  });
});

describe('loadHomeConfig — absent file (primary case)', () => {
  it('returns all defaults, including mirror.enabled === false', () => {
    const config = loadHomeConfig();
    expect(config.version).toBe(1);
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.maxMilestonesPerProject).toBe(40);
    expect(config.memory.maxEventBytes).toBe(2_000_000);
    expect(config.memory.mirror.enabled).toBe(false);
    expect(config.memory.mirror.target).toBe(
      path.join(os.homedir(), 'dev/git-folder/build-loop-memory')
    );
  });
});

describe('loadHomeConfig — malformed file', () => {
  it('falls back to defaults silently rather than throwing', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(homeConfigPath(), '{ this is not json');

    expect(() => loadHomeConfig()).not.toThrow();
    const config = loadHomeConfig();
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.mirror.enabled).toBe(false);
  });
});

describe('loadHomeConfig — partial file', () => {
  it('deep-merges a partial override over defaults', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({
        memory: {
          maxMilestonesPerProject: 100,
          mirror: { enabled: true },
        },
      })
    );

    const config = loadHomeConfig();
    // Overridden.
    expect(config.memory.maxMilestonesPerProject).toBe(100);
    expect(config.memory.mirror.enabled).toBe(true);
    // Untouched keys keep their defaults.
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.maxEventBytes).toBe(2_000_000);
    expect(config.memory.mirror.target).toBe(
      path.join(os.homedir(), 'dev/git-folder/build-loop-memory')
    );
  });

  it('ignores an unknown key rather than erroring', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { enabled: true, notARealKey: 'surprise' }, extraTopLevel: 1 })
    );

    expect(() => loadHomeConfig()).not.toThrow();
    const config = loadHomeConfig();
    expect(config.memory.enabled).toBe(true);
    expect((config as unknown as Record<string, unknown>)['extraTopLevel']).toBeUndefined();
    expect(
      (config.memory as unknown as Record<string, unknown>)['notARealKey']
    ).toBeUndefined();
  });

  it('ignores a type-mismatched value and keeps the default', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { enabled: 'yes please' } }) // string, not boolean
    );

    const config = loadHomeConfig();
    expect(config.memory.enabled).toBe(true); // default, not the malformed string
  });
});

describe('loadHomeConfig — ~/ expansion', () => {
  it('expands a leading ~/ in mirror.target to os.homedir()', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { mirror: { target: '~/somewhere/else' } } })
    );

    const config = loadHomeConfig();
    expect(config.memory.mirror.target).toBe(path.join(os.homedir(), 'somewhere/else'));
  });

  it('leaves an absolute target untouched', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { mirror: { target: '/absolute/path' } } })
    );

    const config = loadHomeConfig();
    expect(config.memory.mirror.target).toBe('/absolute/path');
  });
});

describe('loadHomeConfig — env precedence (env > file > default)', () => {
  it('NAVGATOR_MEMORY=0 beats a file that sets memory.enabled=true', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(homeConfigPath(), JSON.stringify({ memory: { enabled: true } }));
    process.env.NAVGATOR_MEMORY = '0';

    expect(loadHomeConfig().memory.enabled).toBe(false);
  });

  it('NAVGATOR_MEMORY=false (case-insensitive) also disables', () => {
    process.env.NAVGATOR_MEMORY = 'FALSE';
    expect(loadHomeConfig().memory.enabled).toBe(false);
  });

  it('NAVGATOR_MEMORY_MIRROR=1 beats a file that sets mirror.enabled=false', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(homeConfigPath(), JSON.stringify({ memory: { mirror: { enabled: false } } }));
    process.env.NAVGATOR_MEMORY_MIRROR = '1';

    expect(loadHomeConfig().memory.mirror.enabled).toBe(true);
  });

  it('NAVGATOR_MEMORY_MIRROR_TARGET overrides the file target, and is still ~/-expanded', () => {
    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(
      homeConfigPath(),
      JSON.stringify({ memory: { mirror: { target: '/from/file' } } })
    );
    process.env.NAVGATOR_MEMORY_MIRROR_TARGET = '~/from/env';

    expect(loadHomeConfig().memory.mirror.target).toBe(path.join(os.homedir(), 'from/env'));
  });
});

describe('resetHomeConfigCache', () => {
  it('forces a re-read on the next call', () => {
    expect(loadHomeConfig().memory.enabled).toBe(true);

    fs.mkdirSync(path.dirname(homeConfigPath()), { recursive: true });
    fs.writeFileSync(homeConfigPath(), JSON.stringify({ memory: { enabled: false } }));

    // Without a reset, the cached value from the first call would still win.
    expect(loadHomeConfig().memory.enabled).toBe(true);

    resetHomeConfigCache();
    expect(loadHomeConfig().memory.enabled).toBe(false);
  });
});
