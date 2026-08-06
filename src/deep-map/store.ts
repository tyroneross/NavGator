/**
 * deep-map run store.
 *
 * Layout, alongside `.navgator/architecture/` and never inside it:
 *
 *   .navgator/deep-map/
 *     latest.json                       { run_id }
 *     runs/<run_id>/manifest.json
 *     runs/<run_id>/packets/<id>.json         written by NavGator
 *     runs/<run_id>/packets/<id>.result.json  written by the calling agent
 *     runs/<run_id>/findings.jsonl            validated, attributed
 *     runs/<run_id>/ingest.json               accept/reject accounting
 *
 * Keeping this tree separate from `architecture/` is what makes the LLM layer
 * removable: `rm -rf .navgator/deep-map` restores a pure tier-0 install, and no
 * scanner code reads anything under here.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { getConfig, getStoragePath, isContainedPath } from '../config.js';
import type { NavGatorConfig } from '../types.js';
import type {
  DeepMapFinding,
  DeepMapFindingKind,
  DeepMapIngestReport,
  DeepMapManifest,
  DeepMapPacket,
} from './types.js';

/** Root of the deep-map tree: sibling of the architecture store. */
export function getDeepMapPath(config?: NavGatorConfig, projectRoot?: string): string {
  const cfg = config || getConfig();
  return path.resolve(getStoragePath(cfg, projectRoot), '..', 'deep-map');
}

export function getRunsPath(config?: NavGatorConfig, projectRoot?: string): string {
  return path.join(getDeepMapPath(config, projectRoot), 'runs');
}

export function getRunPath(runId: string, config?: NavGatorConfig, projectRoot?: string): string {
  return path.join(getRunsPath(config, projectRoot), assertSafeRunId(runId));
}

export function getPacketsPath(runId: string, config?: NavGatorConfig, projectRoot?: string): string {
  return path.join(getRunPath(runId, config, projectRoot), 'packets');
}

/**
 * True when `candidate` is `root` itself or lies beneath it.
 *
 * Re-exported from `config.ts` rather than reimplemented: two containment
 * checks in one codebase is how one of them ends up wrong, which is exactly
 * what had happened — `sanitizePath` used a bare `startsWith` that accepts
 * `/base-other` for a root of `/base`.
 */
export const isContained = isContainedPath;

/**
 * Run ids are generated here and only ever read back from our own tree, but
 * they also arrive from `--run` on the command line. Restricting the charset
 * means a run id can never contribute a path segment.
 */
const RUN_ID_RE = /^DM_[0-9]{8}T[0-9]{6}Z_[0-9a-f]{8}$/;

export function isValidRunId(runId: string): boolean {
  return RUN_ID_RE.test(runId);
}

function assertSafeRunId(runId: string): string {
  if (!isValidRunId(runId)) {
    throw new Error(`invalid deep-map run id: ${JSON.stringify(runId)}`);
  }
  return runId;
}

/** `DM_<utc compact timestamp>_<8 hex>` — sortable, collision-resistant. */
export function generateRunId(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `DM_${iso}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Packet ids are derived, never user-supplied, but stay path-safe by construction. */
export function makePacketId(tier: number, ordinal: number): string {
  return `DMP_t${tier}_${String(ordinal).padStart(3, '0')}`;
}

const PACKET_ID_RE = /^DMP_t[123]_[0-9]{3}$/;

export function isValidPacketId(packetId: string): boolean {
  return PACKET_ID_RE.test(packetId);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, contents, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function writeManifest(
  manifest: DeepMapManifest,
  config?: NavGatorConfig,
  projectRoot?: string
): string {
  const target = path.join(getRunPath(manifest.run_id, config, projectRoot), 'manifest.json');
  atomicWrite(target, JSON.stringify(manifest, null, 2));
  return target;
}

export function writePacket(
  packet: DeepMapPacket,
  config?: NavGatorConfig,
  projectRoot?: string
): string {
  if (!isValidPacketId(packet.packet_id)) {
    throw new Error(`invalid packet id: ${JSON.stringify(packet.packet_id)}`);
  }
  const target = path.join(
    getPacketsPath(packet.run_id, config, projectRoot),
    `${packet.packet_id}.json`
  );
  atomicWrite(target, JSON.stringify(packet, null, 2));
  return target;
}

export function writeLatest(runId: string, config?: NavGatorConfig, projectRoot?: string): void {
  const target = path.join(getDeepMapPath(config, projectRoot), 'latest.json');
  atomicWrite(target, JSON.stringify({ run_id: assertSafeRunId(runId) }, null, 2));
}

export function writeFindings(
  runId: string,
  findings: DeepMapFinding[],
  config?: NavGatorConfig,
  projectRoot?: string
): string {
  const target = path.join(getRunPath(runId, config, projectRoot), 'findings.jsonl');
  atomicWrite(target, findings.map((f) => JSON.stringify(f)).join('\n') + (findings.length ? '\n' : ''));
  return target;
}

export function writeIngestReport(
  report: DeepMapIngestReport,
  config?: NavGatorConfig,
  projectRoot?: string
): string {
  const target = path.join(getRunPath(report.run_id, config, projectRoot), 'ingest.json');
  atomicWrite(target, JSON.stringify(report, null, 2));
  return target;
}

// ---------------------------------------------------------------------------
// Reads. Every one returns null rather than throwing on a missing or corrupt
// file — an absent deep-map tree is the normal case, not an error.
// ---------------------------------------------------------------------------

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function readLatestRunId(config?: NavGatorConfig, projectRoot?: string): string | null {
  const parsed = readJson<{ run_id?: string }>(
    path.join(getDeepMapPath(config, projectRoot), 'latest.json')
  );
  if (!parsed?.run_id || !isValidRunId(parsed.run_id)) return null;
  return parsed.run_id;
}

export function readManifest(
  runId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): DeepMapManifest | null {
  if (!isValidRunId(runId)) return null;
  return readJson<DeepMapManifest>(path.join(getRunPath(runId, config, projectRoot), 'manifest.json'));
}

export function readIngestReport(
  runId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): DeepMapIngestReport | null {
  if (!isValidRunId(runId)) return null;
  return readJson<DeepMapIngestReport>(path.join(getRunPath(runId, config, projectRoot), 'ingest.json'));
}

/**
 * Mirrors `DeepMapFindingKind` in `./types.ts`. Kept as a local runtime array
 * rather than imported from `./ingest.ts` (which owns the canonical copy) to
 * avoid a store<->ingest import cycle — this module is the lower layer.
 */
const VALID_FINDING_KINDS: readonly DeepMapFindingKind[] = [
  'purpose',
  'responsibility',
  'concern',
  'inefficiency',
  'risk',
  'cross-cutting',
];

/**
 * True when `value` has every field `DeepMapFinding` requires, with the
 * correct runtime type. `findings.jsonl` may have been written by an older
 * schema version, a concurrent process, or a hand edit — it is re-emitted
 * into a tier-3 prompt and into `report --agent` output, so it is validated
 * the same as any other untrusted input, not trusted because it is our own
 * store.
 */
function isValidFindingShape(value: unknown): value is DeepMapFinding {
  if (value === null || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  if (typeof f['component_id'] !== 'string' || f['component_id'].length === 0) return false;
  if (typeof f['component_name'] !== 'string' || f['component_name'].length === 0) return false;
  if (typeof f['kind'] !== 'string' || !VALID_FINDING_KINDS.includes(f['kind'] as DeepMapFindingKind)) return false;
  if (typeof f['text'] !== 'string' || f['text'].length === 0) return false;
  if (!Array.isArray(f['evidence']) || !f['evidence'].every((e) => typeof e === 'string')) return false;
  if (typeof f['confidence'] !== 'number' || !Number.isFinite(f['confidence'])) return false;
  return true;
}

export function readFindings(
  runId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): DeepMapFinding[] {
  if (!isValidRunId(runId)) return [];
  const target = path.join(getRunPath(runId, config, projectRoot), 'findings.jsonl');
  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf-8');
  } catch {
    return [];
  }
  const out: DeepMapFinding[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A truncated tail line is recoverable — keep what parsed.
      continue;
    }
    if (isValidFindingShape(parsed)) out.push(parsed);
    // Malformed shape (wrong types, missing required fields) is dropped
    // silently, same tolerance as a truncated tail line — this store already
    // treats every line as recoverable-or-skippable, never fatal.
  }
  return out;
}

export function listPacketFiles(
  runId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): string[] {
  if (!isValidRunId(runId)) return [];
  const dir = getPacketsPath(runId, config, projectRoot);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.endsWith('.json') && !n.endsWith('.result.json'))
    .map((n) => path.join(dir, n))
    .sort();
}

export function readPacket(filePath: string): DeepMapPacket | null {
  return readJson<DeepMapPacket>(filePath);
}

/**
 * Resolve a packet's result file, refusing anything that escapes the run's
 * packet directory. The packet id is validated first, so this is belt and
 * braces rather than the only guard.
 */
export function resultPathFor(
  runId: string,
  packetId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): string | null {
  if (!isValidPacketId(packetId)) return null;
  const dir = getPacketsPath(runId, config, projectRoot);
  const candidate = path.join(dir, `${packetId}.result.json`);
  return isContained(dir, candidate) ? candidate : null;
}
