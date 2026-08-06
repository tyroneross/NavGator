/**
 * deep-map report — join manifest + ingest accounting + findings at READ time.
 *
 * Findings live only in `findings.jsonl` (written by `ingestRun`, see
 * `ingest.ts`) and are never folded back into `.navgator/architecture/`. This
 * module is the single place that performs the join, so `rm -rf
 * .navgator/deep-map` always restores a pure tier-0 install with nothing left
 * behind in the scanner's own store.
 */
import type { NavGatorConfig } from '../types.js';
import { type DeepMapReport } from './types.js';
/**
 * Build the report for `runId`, or `null` when the run has no manifest —
 * either it was never planned or the run id does not exist.
 */
export declare function buildReport(runId: string, config?: NavGatorConfig, projectRoot?: string): DeepMapReport | null;
//# sourceMappingURL=report.d.ts.map