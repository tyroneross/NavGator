/**
 * NavGator audit orchestrator — Run 2 / D4, reworked in Run 4 (2026-09-05).
 *
 * Per scan:
 *   1. CENSUS — invariants that can be counted exactly (unresolved endpoints,
 *      dedup collisions) are counted over the whole population, never sampled.
 *   2. ORACLES — precision/recall of the stored map against manifests the
 *      scanner never read (package.json, prisma schema, vercel crons, queue
 *      literals, optional SCIP index). See ./oracles.
 *   3. SCREEN — c=0, n=45 per population at LTPD 5% / β 10%. Zero defects
 *      licenses "95% one-sided confidence true error ≤ 6.4%". Producer's risk on
 *      a 99%-correct map is 36%, so the verdict is triage, never a gate
 *      (research packet §1.3–1.4, protocol steps 6–7).
 *   4. PRECISION SAMPLE — founding n≈370 connections / 200 components (±3pp)
 *      on the first audit or Cochran; routine n≈137 (±5pp) otherwise. Neyman
 *      allocation with a floor of n_h ≥ 30; strata below the floor are sampled
 *      in full and charted under `__pooled` (protocol step 8).
 *   5. VERIFIERS — the six deterministic/LLM checks run once over the union of
 *      inspected facts; `sampled` counts DISTINCT facts (Run 4 defect 3).
 *   6. SPRT — when selected, draws continuation batches until a verdict or the
 *      founding-sample cap, else `inconclusive` (Run 4 defect 4).
 *   7. CHARTS — per-stratum p-chart + EWMA + CUSUM with Phase I/II and version
 *      re-baseline (see ./spc), plus a u-chart on the census series.
 *
 * Hooked from scanner.ts after Phase 4 storage. Must NOT throw out of a scan.
 */
import type { ArchitectureComponent, ArchitectureConnection, AuditReport, NavGatorConfig, NavHashes } from '../types.js';
import { type EwmaState } from './spc.js';
import { type DefectClass } from './verifiers.js';
export type { AuditReport } from '../types.js';
export type AuditPlan = 'AQL' | 'SPRT' | 'Cochran';
export interface AuditOptions {
    /** Override plan selection. */
    plan?: AuditPlan;
    /** Skip the audit entirely (returns null from runAudit). */
    skip?: boolean;
    /** Whether NavGator is running inside an MCP session (enables LLM-judge). */
    isMcpMode?: boolean;
    /** History — used to switch from AQL to SPRT and to seed Neyman priors. */
    priorEwma?: Record<string, EwmaState>;
    priorAuditCount?: number;
    /** Set when previous run breached the chart → forces Cochran (founding sizes). */
    forceCochran?: boolean;
    /** RNG injection for deterministic tests. */
    rand?: () => number;
    /** Run the SCIP imports oracle (spawns scip-typescript). */
    scip?: boolean;
    /** Run manifest oracles (default true). */
    oracles?: boolean;
    /** Inject hashes instead of loading from storage (self-test). */
    hashes?: NavHashes | null;
    /** Facts that MUST be inspected in addition to the random sample (self-test). */
    forceInclude?: {
        components?: ReadonlyArray<ArchitectureComponent>;
        connections?: ReadonlyArray<ArchitectureConnection>;
        files?: ReadonlyArray<string>;
    };
    /** Verifiers to stub out (mutation testing of the self-test). */
    disabledVerifiers?: ReadonlyArray<DefectClass>;
    /** Max defect evidence rows kept on the report (default 20). */
    evidenceCap?: number;
    /** Per-stratum sample floor (default 30). */
    floor?: number;
    /** Allow the prisma oracle to import `@prisma/internals` from the TARGET repo (code execution from an audited repo; default false, env NAVGATOR_TRUST_TARGET_DEPS=1). */
    trustTargetDeps?: boolean;
    /** SCIP indexer timeout in ms (default 120000; env NAVGATOR_SCIP_TIMEOUT_MS). */
    scipTimeoutMs?: number;
}
export declare const SCREEN_LTPD = 0.05;
export declare const SCREEN_BETA = 0.1;
export declare const STRATUM_FLOOR = 30;
export declare function componentStratum(c: ArchitectureComponent): string;
export declare function connectionStratum(c: ArchitectureConnection): string;
export declare function runAudit(scanResult: {
    components: ReadonlyArray<ArchitectureComponent>;
    connections: ReadonlyArray<ArchitectureConnection>;
}, config: NavGatorConfig, projectRoot: string, opts?: AuditOptions): Promise<AuditReport | null>;
export declare const CENSUS_STRATUM = "__census-unresolved";
export declare const POOLED_STRATUM = "__pooled";
export declare function updateEwmaForAudit(prior: Record<string, EwmaState> | undefined, report: AuditReport, version?: string): {
    ewma: Record<string, EwmaState>;
    anyBreach: boolean;
};
//# sourceMappingURL=index.d.ts.map