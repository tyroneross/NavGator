/**
 * Optional one-way mirror: gator-memory (`~/.navgator/memory/`) -> a
 * build-loop-memory tree, if and only if the user has one and opted in.
 *
 * Why this exists: a NavGator user's gator-memory store
 * (`src/memory/store.ts`) is fully self-contained under `~/.navgator/`. Some
 * users -- currently: this repo's owner -- ALSO keep a separate
 * `build-loop-memory` checkout, a durable cross-project knowledge store with
 * its own `projects/<slug>/<lane>/` convention. This module exports the
 * per-project gator-memory record into that tree so the two stores line up,
 * for the humans and agents who already read build-loop-memory and have
 * never heard of gator-memory.
 *
 * THIS IS THE OWNER'S MACHINE-SPECIFIC SETUP, NOT A GENERAL FEATURE. For
 * everyone else the target simply does not exist on disk, and that is the
 * NORMAL case, not an error: default off (`memory.mirror.enabled` in
 * `src/home-config.ts`), detected-never-assumed (`targetExists` is always a
 * live `fs.existsSync` check, never cached or inferred from config), and
 * silent when absent. A user who has never heard of build-loop-memory must
 * never see a warning, a log line, or a created directory from this module.
 *
 * Fail-open by construction, mirroring `src/memory/store.ts`'s posture
 * exactly: every exported function RETURNS rather than throws, including
 * when the feature is off, the target is missing, the record does not exist,
 * or the destination is unwritable. `mirrorProjectMemory` returning `false`
 * is the expected outcome in all of those cases, not a failure signal the
 * caller needs to handle specially.
 *
 * GUEST DISCIPLINE: build-loop's own tooling owns `snapshot.json`,
 * `graph.json`, `file_map.json`, `connections.jsonl`, and any `INDEX.jsonl`
 * inside the target (`scripts/architecture_snapshot.py` writes `snapshot.json`
 * with `provenance: "navgator"`, for instance). This module writes exactly two
 * files per project -- `navgator-memory.json` and `navgator-memory.md` under
 * `<target>/projects/<slug>/architecture/` -- and touches nothing else in the
 * target tree, ever. It is a guest in someone else's store.
 *
 * NEVER CREATE THE TARGET ROOT. The target's absence is the only signal this
 * module has that the user has no build-loop-memory tree; fabricating it here
 * would destroy that signal and make every future call believe the feature is
 * live when it never was opted into by having the tree in the first place.
 * `mirrorProjectMemory` checks `fs.existsSync(targetRoot)` and returns `false`
 * without any `mkdir` when it is absent -- see the early-return below.
 */

import * as fs from 'fs';
import * as path from 'path';

import { loadHomeConfig } from '../home-config.js';
import { readProjectMemory, listProjectMemories, type ProjectMemory, type MemoryEvent } from './store.js';
import { NAVGATOR_VERSION } from '../version.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MirrorStatus {
  /** Config says mirroring is on. */
  enabled: boolean;
  /** Resolved absolute path, `null` when not configured (empty target string). */
  target: string | null;
  /** Detected on disk, NEVER assumed -- see module header. */
  targetExists: boolean;
  /** mtime of the most recently written mirror file under the target, or `null`. */
  lastMirroredAt: number | null;
  /** Count of project directories under `<target>/projects/` carrying a mirror record. */
  projectsMirrored: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const PROJECTS_DIRNAME = 'projects';
const ARCHITECTURE_DIRNAME = 'architecture';
const JSON_FILENAME = 'navgator-memory.json';
const MD_FILENAME = 'navgator-memory.md';

// =============================================================================
// NAME SLUG -- human-readable, distinct from gator-memory's hashed slug
// =============================================================================

/**
 * Collapse a basename into a lowercase, hyphen-separated token.
 *
 * Deliberately NOT imported from `store.ts`'s private `kebab()` (not
 * exported) -- this is the same small algorithm, kept local because the two
 * call sites want different guarantees: gator-memory's slug always carries a
 * hash suffix for uniqueness, while build-loop-memory's existing
 * `projects/<name>/` convention (verified live against
 * `~/dev/git-folder/build-loop-memory/projects/navgator/`) wants a bare,
 * human-readable name with the hash suffix reserved for the collision case
 * only (see `resolveTargetSlug` below).
 */
function kebabName(input: string): string {
  let result = input.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  result = result.replace(/^-+|-+$/g, '');
  result = result.slice(0, 32);
  result = result.replace(/^-+|-+$/g, '');
  return result || 'project';
}

/** Strip control/ANSI characters. Project names and paths are user-controlled text. */
function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

/**
 * Neutralize a string destined for a hand-written, double-quoted YAML
 * scalar. There is no YAML library backing this frontmatter (see the
 * constraints this module was built under), so a literal `"` or `\` in a
 * project name would otherwise terminate the string early or escape the
 * wrong character, corrupting every frontmatter field written after it.
 */
function escapeYamlDoubleQuoted(input: string): string {
  return stripControlChars(input).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null; // Absent, unreadable, or corrupt -- caller treats as "no prior record".
  }
}

// =============================================================================
// STATUS
// =============================================================================

/**
 * Count mirrored project directories and find the most recent mirror mtime
 * under `<target>/projects/`. Read-only, and fail-open at every layer --
 * a status probe must never throw just because a sibling project's
 * directory vanished between `readdir` and `stat`, or because the target
 * has no `projects/` directory yet at all.
 */
function scanMirroredProjects(targetRoot: string): { count: number; lastMirroredAt: number | null } {
  let count = 0;
  let lastMirroredAt: number | null = null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(targetRoot, PROJECTS_DIRNAME), { withFileTypes: true });
  } catch {
    return { count: 0, lastMirroredAt: null }; // No projects/ dir yet -- nothing mirrored.
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(
      targetRoot,
      PROJECTS_DIRNAME,
      entry.name,
      ARCHITECTURE_DIRNAME,
      JSON_FILENAME
    );
    try {
      const stat = fs.statSync(jsonPath);
      count += 1;
      if (lastMirroredAt === null || stat.mtimeMs > lastMirroredAt) lastMirroredAt = stat.mtimeMs;
    } catch {
      // This project directory exists but has no mirror file (yet, or ever) -- skip.
    }
  }

  return { count, lastMirroredAt };
}

/**
 * Report the mirror's configured and detected state. Never throws; a status
 * probe that could crash a caller would be worse than no status at all.
 */
export function mirrorStatus(): MirrorStatus {
  try {
    const config = loadHomeConfig();
    const target = config.memory.mirror.target || null;
    const targetExists = !!target && fs.existsSync(target);

    if (!targetExists || !target) {
      return {
        enabled: config.memory.mirror.enabled,
        target,
        targetExists,
        lastMirroredAt: null,
        projectsMirrored: 0,
      };
    }

    const { count, lastMirroredAt } = scanMirroredProjects(target);
    return {
      enabled: config.memory.mirror.enabled,
      target,
      targetExists,
      lastMirroredAt,
      projectsMirrored: count,
    };
  } catch {
    return { enabled: false, target: null, targetExists: false, lastMirroredAt: null, projectsMirrored: 0 };
  }
}

// =============================================================================
// COLLISION HANDLING
// =============================================================================

/**
 * Pick the directory slug a project's mirror files land at.
 *
 * Two different absolute paths can share a basename -- two checkouts both
 * named `web`. Without this check, the second project's mirror would
 * silently overwrite the first project's record the moment they landed at
 * the same `projects/web/` directory. Reading the CANDIDATE file's own
 * `source_path` (not gator-memory, not the registry -- the mirror file
 * itself) and comparing it against the path being mirrored now is what makes
 * this deterministic and idempotent: mirroring the SAME project twice always
 * reads back its own `source_path`, matches, and reuses the bare slug;
 * mirroring a DIFFERENT project with the same basename never matches, and
 * falls back to a hash-suffixed slug that gator-memory's own uniqueness
 * guarantee (see `slug()` in `store.ts`) makes distinct.
 */
function resolveTargetSlug(
  targetRoot: string,
  baseNameSlug: string,
  resolvedProjectPath: string,
  gatorMemorySlug: string
): string {
  const candidateJson = path.join(
    targetRoot,
    PROJECTS_DIRNAME,
    baseNameSlug,
    ARCHITECTURE_DIRNAME,
    JSON_FILENAME
  );
  const existing = readJsonSafe<{ source_path?: string }>(candidateJson);
  if (existing?.source_path && existing.source_path !== resolvedProjectPath) {
    // gator-memory's slug is always `<kebab>-<8 hex>`; the last 8 characters
    // are always that digest, regardless of what survived the kebab filter
    // in the prefix -- see `slug()`'s own header in `store.ts`.
    return `${baseNameSlug}-${gatorMemorySlug.slice(-8)}`;
  }
  return baseNameSlug;
}

// =============================================================================
// RENDERING
// =============================================================================

function formatMilestoneLine(event: MemoryEvent): string {
  const date = new Date(event.ts).toISOString().slice(0, 10);
  const detail = event.detail;

  if (event.kind === 'architecture.changed' && detail) {
    const parts: string[] = [];
    if (detail.componentsAdded) parts.push(`+${detail.componentsAdded} components`);
    if (detail.componentsRemoved) parts.push(`-${detail.componentsRemoved} components`);
    if (detail.connectionsAdded) parts.push(`+${detail.connectionsAdded} connections`);
    if (detail.connectionsRemoved) parts.push(`-${detail.connectionsRemoved} connections`);
    const body = parts.length > 0 ? parts.join(', ') : event.summary;
    const significance = detail.significance ? ` (${detail.significance})` : '';
    return `- ${date} — ${event.kind}: ${body}${significance}`;
  }

  return `- ${date} — ${event.kind}: ${event.summary}`;
}

function renderMarkdown(
  record: ProjectMemory,
  targetSlug: string,
  gatorMemorySlug: string,
  createdAt: string,
  updatedAt: string
): string {
  const name = stripControlChars(record.name);
  const description = escapeYamlDoubleQuoted(`NavGator architecture memory for ${record.name}.`);
  const sourcePath = escapeYamlDoubleQuoted(record.path);

  const latest = record.latest ?? {};
  // Reverse-chronological: milestones[] is stored oldest-first (oldest
  // evicted first when the MAX_MILESTONES cap is hit), so reading it
  // newest-first for a human skimming cold means reversing here.
  const milestoneLines =
    record.milestones.length > 0
      ? [...record.milestones].reverse().map(formatMilestoneLine).join('\n')
      : '- (no milestones recorded yet)';

  return `---
name: ${targetSlug}-navgator-memory
description: "${description}"
type: reference
source_path: ${sourcePath}
source_tool: navgator
source_version: ${NAVGATOR_VERSION}
gator_memory_slug: ${gatorMemorySlug}
created_at: ${createdAt}
last_updated_at: ${updatedAt}
---

# ${name}

- Path: \`${record.path}\`
- Status: ${record.status}
- First seen: ${createdAt}
- Last seen: ${updatedAt}
- Scans: ${record.counters.scans}
- Significant changes: ${record.counters.significantChanges}

## Latest snapshot

- Components: ${latest.components ?? '—'}
- Connections: ${latest.connections ?? '—'}
- Prompts: ${latest.prompts ?? '—'}
- Branch: ${latest.branch ?? '—'}
- Commit: ${latest.commit ?? '—'}

## Milestones (most recent first)

${milestoneLines}
`;
}

/**
 * The JSON mirror is the raw `ProjectMemory` record plus the same
 * provenance fields as the markdown frontmatter. Idempotent full rewrite --
 * no append, no merge -- so mirroring the same project twice in a row
 * produces byte-for-byte the same file (given an unchanged record), which is
 * exactly what the idempotence test in this chunk asserts.
 */
function buildJsonMirror(
  record: ProjectMemory,
  gatorMemorySlug: string,
  createdAt: string,
  updatedAt: string
): Record<string, unknown> {
  return {
    ...record,
    source_path: record.path,
    source_tool: 'navgator',
    source_version: NAVGATOR_VERSION,
    gator_memory_slug: gatorMemorySlug,
    created_at: createdAt,
    last_updated_at: updatedAt,
  };
}

// =============================================================================
// WRITE
// =============================================================================

/**
 * Mirror one project's gator-memory record into the configured
 * build-loop-memory target. Returns `false` -- never throws -- when the
 * feature is off, the target is unconfigured or absent, the project has no
 * gator-memory record, or the write fails for any reason (permissions,
 * disk full, etc). `false` is the expected, silent outcome for the large
 * majority of NavGator installs; it is not an error signal.
 *
 * Called on significant events only (wiring lands in a separate chunk --
 * `src/projects.ts` and `src/scanner.ts` are owned elsewhere right now).
 */
export async function mirrorProjectMemory(projectPath: string): Promise<boolean> {
  try {
    const config = loadHomeConfig();
    if (!config.memory.mirror.enabled) return false;

    const targetRoot = config.memory.mirror.target;
    if (!targetRoot) return false;

    // The target root's absence IS the detection signal for "this user has
    // no build-loop-memory tree" -- see module header. Do not `mkdir` it.
    if (!fs.existsSync(targetRoot)) return false;

    const record = readProjectMemory(projectPath);
    if (!record) return false;

    const gatorMemorySlug = record.slug;
    const baseNameSlug = kebabName(path.basename(record.path));
    const targetSlug = resolveTargetSlug(targetRoot, baseNameSlug, record.path, gatorMemorySlug);

    const architectureDir = path.join(targetRoot, PROJECTS_DIRNAME, targetSlug, ARCHITECTURE_DIRNAME);
    // Create only OUR OWN `projects/<slug>/architecture/` path. Never touches
    // `snapshot.json`, `graph.json`, `INDEX.jsonl`, or anything else in the
    // target -- those belong to build-loop's own tooling. See module header.
    await fs.promises.mkdir(architectureDir, { recursive: true });

    const createdAt = new Date(record.firstSeen).toISOString();
    const updatedAt = new Date(record.lastSeen).toISOString();

    const json = buildJsonMirror(record, gatorMemorySlug, createdAt, updatedAt);
    const markdown = renderMarkdown(record, targetSlug, gatorMemorySlug, createdAt, updatedAt);

    await fs.promises.writeFile(
      path.join(architectureDir, JSON_FILENAME),
      JSON.stringify(json, null, 2) + '\n',
      'utf-8'
    );
    await fs.promises.writeFile(path.join(architectureDir, MD_FILENAME), markdown, 'utf-8');

    return true;
  } catch {
    // Fail-open -- a broken or unwritable mirror target must never break a
    // scan or a gator-memory capture. See module header.
    return false;
  }
}

/**
 * Mirror every known gator-memory project record. The on-demand path for a
 * later `doctor --mirror` flag; NOT wired to any automatic trigger by this
 * chunk. Sequential rather than concurrent -- the target tree is a single
 * shared destination, and there is no reader here that needs the speed of
 * parallel writes badly enough to risk racing on it.
 */
export async function mirrorAll(): Promise<{ mirrored: number; skipped: number }> {
  try {
    const records = listProjectMemories();
    let mirrored = 0;
    let skipped = 0;
    for (const record of records) {
      const ok = await mirrorProjectMemory(record.path);
      if (ok) mirrored += 1;
      else skipped += 1;
    }
    return { mirrored, skipped };
  } catch {
    return { mirrored: 0, skipped: 0 };
  }
}
