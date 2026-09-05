/**
 * cron oracle — truth frame: `vercel.json` → `crons[].path`.
 *
 * Map side: `cron` components tagged `vercel` or sourced from vercel.json.
 * The cron scanner names the component by the cron path, so the join key is
 * the path string. Recall is exact (the manifest enumerates truth).
 */

import * as path from 'path';
import { noOracle, readJsonSafe, setDiffOracle, type OracleInput, type OracleResult } from './common.js';

interface VercelJson {
  crons?: Array<{ path?: string; schedule?: string }>;
}

export function cronOracle(input: OracleInput): OracleResult {
  const vercel = readJsonSafe<VercelJson>(path.join(input.projectRoot, 'vercel.json'));
  if (!vercel) return noOracle('cron', 'infra', 'no readable vercel.json at project root');
  const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
  const truth = new Set<string>();
  for (const c of crons) if (typeof c?.path === 'string' && c.path.length > 0) truth.add(c.path);
  // Run 4 fix2 #3: vercel.json present and parseable with no crons is a valid
  // empty frame — every vercel-sourced cron component is a false positive.

  const map = new Set<string>();
  for (const c of input.components) {
    if (c.type !== 'cron') continue;
    const fromVercel =
      (c.tags ?? []).includes('vercel') ||
      (c.source?.config_files ?? []).some((f) => path.basename(f) === 'vercel.json');
    if (fromVercel) map.add(c.name);
  }
  return setDiffOracle('cron', 'infra', 'independent', truth, map, [
    'truth = vercel.json crons[].path; map = cron components sourced from vercel.json',
    ...(truth.size === 0 ? ['vercel.json declares no crons: empty frame, every vercel-sourced cron component is a false positive'] : []),
  ]);
}
