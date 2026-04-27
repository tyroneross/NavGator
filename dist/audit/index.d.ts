/**
 * NavGator audit orchestrator — Run 2 / D4
 *
 * Picks a sampling plan (AQL / SPRT / Cochran), stratifies the population,
 * runs the six verifiers in parallel, aggregates into a single AuditReport.
 *
 * Hooked from scanner.ts after Phase 4 storage write, before Phase 5 timeline.
 * Must NOT cause the scan to fail — only updates EWMA and sets `drift_breach`
 * on the timeline entry, which the next scan reads to auto-promote.
 */
import type { ArchitectureComponent, ArchitectureConnection, NavGatorConfig } from '../types.js';
import { type EwmaState } from './spc.js';
import { type DefectClass, type SampleEvidence } from './verifiers.js';
export type AuditPlan = 'AQL' | 'SPRT' | 'Cochran';
export interface AuditReport {
    plan: AuditPlan;
    /** Total sample size requested by the plan (may differ from actual sampled). */
    n: number;
    /** Acceptance number (only meaningful for AQL). */
    c: number;
    /** Total facts actually inspected across all verifiers. */
    sampled: number;
    /** Total defects found across all verifiers. */
    defects: number;
    /** defects / sampled (or 0 if sampled=0). */
    defect_rate: number;
    by_class: Partial<Record<DefectClass, {
        sampled: number;
        defects: number;
    }>>;
    by_stratum: Record<string, {
        sampled: number;
        defects: number;
        defect_rate: number;
    }>;
    /** True when MISSED_EDGE verifier was skipped (CLI mode). */
    llm_skipped?: boolean;
    /** Plan verdict: accept / reject / continue (SPRT only) / accept-on-c. */
    verdict: 'accept' | 'reject' | 'continue';
    /** EWMA breach detected on this run for at least one stratum. */
    drift_breach?: boolean;
    timestamp: number;
    /** Compact evidence snippets for failures (capped to 20 to keep timeline.json small). */
    defect_evidence?: SampleEvidence[];
}
export interface AuditOptions {
    /** Override plan selection. */
    plan?: AuditPlan;
    /** Skip the audit entirely (returns null from runAudit). */
    skip?: boolean;
    /** Whether NavGator is running inside an MCP session (enables LLM-judge). */
    isMcpMode?: boolean;
    /** History — used to switch from AQL to SPRT and to seed EWMA. */
    priorEwma?: Record<string, EwmaState>;
    priorAuditCount?: number;
    /** Set when previous run breached EWMA → forces Cochran. */
    forceCochran?: boolean;
    /** RNG injection for deterministic tests. */
    rand?: () => number;
}
export declare function runAudit(scanResult: {
    components: ReadonlyArray<ArchitectureComponent>;
    connections: ReadonlyArray<ArchitectureConnection>;
}, config: NavGatorConfig, projectRoot: string, opts?: AuditOptions): Promise<AuditReport | null>;
export declare function updateEwmaForAudit(prior: Record<string, EwmaState> | undefined, report: AuditReport): {
    ewma: Record<string, EwmaState>;
    anyBreach: boolean;
};
//# sourceMappingURL=index.d.ts.map