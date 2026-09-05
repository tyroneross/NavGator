/**
 * `navgator audit-report` — Run 4 (2026-09-05).
 *
 * Reads the stored audit history (timeline entries carrying `audit`), the
 * per-stratum control-chart state on index.json, and prints:
 *   - the last N audits (plan, distinct facts sampled, defects, rate + 95% CI, verdict)
 *   - the c=0 screen with its producer's-risk caveat
 *   - the census (exact unresolved-endpoint count, by type and top dir)
 *   - oracle precision/recall with intervals (stored from the last scan, or
 *     recomputed live with --oracles / --scip)
 *   - chart state per stratum (phase, centre, limits, last points, signals)
 *   - optional --self-test: plants K defects per class into an in-memory
 *     clone of the graph and reports per-class instrument recall.
 *
 * Output: --md (default) or --json. Read-only except for the SCIP indexer's
 * temp file when --scip is passed.
 */
import { Command } from 'commander';
import type { AuditOracleResult, AuditReport, EwmaStateSnapshot, ProportionInterval } from '../../types.js';
import { type SelfTestReport } from '../../audit/self-test.js';
interface AuditReportData {
    navgator_version: string;
    project_root: string;
    generated_at: number;
    audit_history_count: number;
    pending_drift_breach: boolean;
    audits: Array<{
        timestamp: number;
        scan_type?: string;
        plan: string;
        n: number;
        sampled: number;
        defects: number;
        defect_rate: number;
        ci: ProportionInterval;
        verdict: string;
        drift_breach: boolean;
        navgator_version?: string;
        screen?: AuditReport['screen'];
        sprt?: AuditReport['sprt'];
    }>;
    latest: AuditReport | null;
    charts: Record<string, EwmaStateSnapshot>;
    live_oracles?: AuditOracleResult[];
    self_test?: SelfTestReport;
}
export declare function registerAuditReportCommand(program: Command): void;
export declare function renderMarkdown(d: AuditReportData): string;
export {};
//# sourceMappingURL=audit-report.d.ts.map