/** Live coverage and scan freshness for an architecture review. Read-only. */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { getConfig, getIndexPath } from './config.js';

const execFileAsync = promisify(execFile);
const MAX_SAMPLE = 25;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ReviewScope {
  available: boolean;
  reason?: string;
  base_ref: string | null;
  branch_base_known: boolean;
  scope_prefix: string | null;
  outside_scope: number;
  counts: { committed: number; staged: number; unstaged: number; untracked: number; total: number };
  changed_sample: string[];
  omitted_changed: number;
  scan: { status: 'fresh' | 'stale' | 'missing' | 'invalid'; last_scan: number | null; age_hours: number | null };
  behavioral_review: { required: boolean; matched_count: number; sample: string[] };
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root, timeout: 3000, maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

function paths(raw: string | null): string[] {
  return raw === null ? [] : raw.split('\0').filter(Boolean);
}

function scanState(root: string, now: number): ReviewScope['scan'] {
  const index = getIndexPath(getConfig(), root);
  if (!fs.existsSync(index)) return { status: 'missing', last_scan: null, age_hours: null };
  try {
    const lastScan = JSON.parse(fs.readFileSync(index, 'utf8')).last_scan;
    if (typeof lastScan !== 'number' || !Number.isFinite(lastScan) || lastScan > now) {
      return { status: 'invalid', last_scan: null, age_hours: null };
    }
    const ageMs = now - lastScan;
    return { status: ageMs > MAX_AGE_MS ? 'stale' : 'fresh',
      last_scan: lastScan, age_hours: Math.round(ageMs / 360000) / 10 };
  } catch {
    return { status: 'invalid', last_scan: null, age_hours: null };
  }
}

function needsBehavioralReview(file: string): boolean {
  if (/(?:^|\/)(?:raw|vendor|node_modules|__tests__|tests|testdata|fixtures)(?:\/|$)/i.test(file)
      || /(?:^|\/)(?:test_|.*[.-](?:test|spec)\.)/i.test(file)) return false;
  return /\.(?:py|[cm]?js|[cm]?ts|tsx|go|rs|swift)$/.test(file)
    && /(?:^|[/_.-])(search|retriev\w*|rank\w*|query|router|routing|filter|sqlite|graph|index|store|llmwiki|vault_vector|fts|bm25|intent|evidence)(?:[/_.-]|$)/i.test(file);
}

/** Includes branch delta and every live checkout surface; samples are bounded. */
export async function collectReviewScope(projectRoot: string, now = Date.now(), prefix?: string): Promise<ReviewScope> {
  const scopePrefix = prefix?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || null;
  const top = await git(projectRoot, ['rev-parse', '--show-toplevel']);
  const emptyCounts = { committed: 0, staged: 0, unstaged: 0, untracked: 0, total: 0 };
  if (!top) {
    const scan = scanState(projectRoot, now);
    return { available: false, reason: 'not_git_repository', base_ref: null,
      branch_base_known: false, scope_prefix: scopePrefix, outside_scope: 0,
      counts: emptyCounts, changed_sample: [],
      omitted_changed: 0, scan, behavioral_review: { required: false, matched_count: 0, sample: [] } };
  }
  const root = top.trim();
  const scan = scanState(root, now);
  const symbolic = await git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const candidate = symbolic?.trim() || 'refs/remotes/origin/main';
  const mergeBase = await git(root, ['merge-base', candidate, 'HEAD']);
  const base = mergeBase?.trim() || 'HEAD';
  const [committedRaw, stagedRaw, unstagedRaw, untrackedRaw] = await Promise.all([
    git(root, ['diff', '--name-only', '-z', `${base}..HEAD`]),
    git(root, ['diff', '--cached', '--name-only', '-z']),
    git(root, ['diff', '--name-only', '-z']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  if ([committedRaw, stagedRaw, unstagedRaw, untrackedRaw].some(value => value === null)) {
    return { available: false, reason: 'git_inventory_failed', base_ref: base,
      branch_base_known: Boolean(mergeBase), scope_prefix: scopePrefix, outside_scope: 0,
      counts: emptyCounts, changed_sample: [],
      omitted_changed: 0, scan, behavioral_review: { required: false, matched_count: 0, sample: [] } };
  }
  const rawSurfaces = [committedRaw, stagedRaw, unstagedRaw, untrackedRaw].map(paths);
  const allChanged = new Set(rawSurfaces.flat());
  const inScope = (file: string) => !scopePrefix || file === scopePrefix || file.startsWith(`${scopePrefix}/`);
  const surfaces = rawSurfaces.map(surface => surface.filter(inScope));
  const all = [...new Set(surfaces.flat())].sort();
  const behavioral = all.filter(needsBehavioralReview);
  return {
    available: true,
    base_ref: base,
    branch_base_known: Boolean(mergeBase),
    scope_prefix: scopePrefix,
    outside_scope: allChanged.size - all.length,
    counts: { committed: surfaces[0].length, staged: surfaces[1].length,
      unstaged: surfaces[2].length, untracked: surfaces[3].length, total: all.length },
    changed_sample: all.slice(0, MAX_SAMPLE),
    omitted_changed: Math.max(0, all.length - MAX_SAMPLE),
    scan,
    behavioral_review: { required: behavioral.length > 0, matched_count: behavioral.length,
      sample: behavioral.slice(0, MAX_SAMPLE) },
  };
}
