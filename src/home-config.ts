/**
 * Loader for `~/.navgator/config.json` — home-scoped configuration.
 *
 * `src/config.ts` already exists, but it is project/storage scoped: it
 * answers "where does THIS project's architecture data live?" and is loaded
 * fresh per project via env vars (`NAVGATOR_MODE`, `NAVGATOR_PATH`, etc.).
 * This module answers a different question — "what does the USER want,
 * machine-wide, for the one thing every project shares: `~/.navgator/`?" —
 * which is why it is a separate module rather than an addition to
 * `config.ts`. Today the only home-scoped feature is gator-memory
 * (`src/memory/store.ts`), but the shape leaves room for more.
 *
 * This module never WRITES the file. Reading is the only supported path; a
 * later chunk documents the shape for a user to hand-author. That is a
 * deliberate asymmetry with `src/config.ts`, which has no file at all today —
 * `home-config.ts` has a file, but this module is not the thing that
 * produces it.
 *
 * Fail-open, mirroring every other config loader in this codebase
 * (`journalEnabled()` in `registry-journal.ts`, `getConfig()` in
 * `config.ts`): an absent file is the primary case and produces all
 * defaults; a malformed file ALSO produces all defaults, silently, rather
 * than throwing and taking down whatever called in to check
 * `memory.enabled`. A broken config file must never break a scan.
 *
 * Precedence is env > file > default, applied in that order in
 * `loadHomeConfig()`. An unknown key in the file is ignored rather than
 * rejected — `deepMerge` only ever merges keys that exist in
 * `DEFAULT_HOME_CONFIG`'s shape, and only when the override's type matches
 * the default's type, so a typo'd or forward-compatible key in a hand-edited
 * config degrades to "ignored" rather than "config is now broken".
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface NavGatorHomeConfig {
  version: number;
  memory: {
    enabled: boolean;
    maxMilestonesPerProject: number;
    maxEventBytes: number;
    mirror: {
      enabled: boolean;
      target: string;
    };
  };
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_HOME_CONFIG: NavGatorHomeConfig = {
  version: 1,
  memory: {
    enabled: true,
    maxMilestonesPerProject: 40,
    maxEventBytes: 2_000_000,
    mirror: {
      // Off by default: mirroring writes OUTSIDE ~/.navgator, into a path the
      // user chooses. That must be opt-in, never a default a fresh install
      // silently activates.
      enabled: false,
      target: '~/dev/git-folder/build-loop-memory',
    },
  },
};

// =============================================================================
// PATH
// =============================================================================

/**
 * Resolved PER CALL, never a module-level const — same reasoning as
 * `memoryDir()` in `src/memory/store.ts`: a test that redirects `$HOME`
 * before calling in must actually redirect this path too.
 */
export function homeConfigPath(): string {
  return path.join(os.homedir(), '.navgator', 'config.json');
}

// =============================================================================
// MERGE
// =============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge `override` onto `base`, but ONLY for keys that already exist in
 * `base`'s shape, and only when the override's value is the same primitive
 * type as the default (or both are plain objects, in which case the merge
 * recurses). This is what makes "unknown key is ignored" and "malformed
 * value falls back to default" true at the same time, without a schema
 * validation library.
 */
function deepMerge<T extends object>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;

  const baseRecord = base as Record<string, unknown>;
  const result: Record<string, unknown> = { ...baseRecord };
  for (const key of Object.keys(baseRecord)) {
    if (!(key in override)) continue;
    const overrideValue = override[key];
    const baseValue = baseRecord[key];

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else if (typeof overrideValue === typeof baseValue) {
      result[key] = overrideValue;
    }
    // Type mismatch or unknown key: silently keep the default. Fail-open.
  }
  return result as T;
}

// =============================================================================
// ENV OVERRIDES
// =============================================================================

/**
 * `NAVGATOR_MEMORY` (`0`/`false`, case-insensitive, turns memory off),
 * `NAVGATOR_MEMORY_MIRROR` (`1`/`true` turns mirroring on),
 * `NAVGATOR_MEMORY_MIRROR_TARGET` (overrides the mirror path). Applied AFTER
 * the file merge, so env always wins over whatever is on disk.
 */
function applyEnvOverrides(config: NavGatorHomeConfig): NavGatorHomeConfig {
  const result: NavGatorHomeConfig = {
    ...config,
    memory: { ...config.memory, mirror: { ...config.memory.mirror } },
  };

  const memoryRaw = process.env.NAVGATOR_MEMORY;
  if (memoryRaw !== undefined) {
    result.memory.enabled = memoryRaw !== '0' && memoryRaw.toLowerCase() !== 'false';
  }

  const mirrorRaw = process.env.NAVGATOR_MEMORY_MIRROR;
  if (mirrorRaw !== undefined) {
    result.memory.mirror.enabled = mirrorRaw === '1' || mirrorRaw.toLowerCase() === 'true';
  }

  const mirrorTarget = process.env.NAVGATOR_MEMORY_MIRROR_TARGET;
  if (mirrorTarget) {
    result.memory.mirror.target = mirrorTarget;
  }

  return result;
}

/** Expand a leading `~/` (or a bare `~`) to `os.homedir()`. */
function expandHome(target: string): string {
  if (target === '~') return os.homedir();
  if (target.startsWith('~/')) return path.join(os.homedir(), target.slice(2));
  return target;
}

// =============================================================================
// LOAD
// =============================================================================

function readRawConfig(): unknown {
  try {
    const raw = fs.readFileSync(homeConfigPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Absent or malformed — the caller falls back to defaults. This is the
    // PRIMARY case: most installs never hand-author this file.
    return null;
  }
}

let cachedConfig: NavGatorHomeConfig | null = null;

/**
 * Load `~/.navgator/config.json`, merged over defaults, with env overrides
 * applied last. Cached after the first call; use `resetHomeConfigCache()`
 * (test seam, mirrors `resetConfig()` in `src/config.ts:391-393`) to force a
 * re-read.
 */
export function loadHomeConfig(): NavGatorHomeConfig {
  if (cachedConfig) return cachedConfig;

  const raw = readRawConfig();
  const merged = deepMerge(DEFAULT_HOME_CONFIG, raw ?? {});
  const withEnv = applyEnvOverrides(merged);
  withEnv.memory.mirror.target = expandHome(withEnv.memory.mirror.target);

  cachedConfig = withEnv;
  return cachedConfig;
}

/** Test seam: forget the cached config so the next `loadHomeConfig()` re-reads. */
export function resetHomeConfigCache(): void {
  cachedConfig = null;
}
