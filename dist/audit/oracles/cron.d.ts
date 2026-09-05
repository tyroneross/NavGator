/**
 * cron oracle — truth frame: `vercel.json` → `crons[].path`.
 *
 * Map side: `cron` components tagged `vercel` or sourced from vercel.json.
 * The cron scanner names the component by the cron path, so the join key is
 * the path string. Recall is exact (the manifest enumerates truth).
 */
import { type OracleInput, type OracleResult } from './common.js';
export declare function cronOracle(input: OracleInput): OracleResult;
//# sourceMappingURL=cron.d.ts.map