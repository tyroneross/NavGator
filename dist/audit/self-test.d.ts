/**
 * NavGator audit self-test — Run 4 (2026-09-05).
 *
 * "A gate is not evidence until it has failed on a planted defect." This
 * module clones the stored graph IN MEMORY, plants K known defects per class,
 * runs the real audit at the stated plan with the planted facts guaranteed to
 * be inspected, and reports per-class recall of the instrument.
 *
 * What it measures: verifier sensitivity — given that a defective fact is
 * inspected, does the verifier flag it? Sampling power (the chance a random
 * sample reaches a given defect) is a separate number reported alongside as
 * `sampling_power`, computed from the plan, not from the plant. Research
 * packet §2.5(c): a seeded-defect check "measures recall on changes ... it
 * does not estimate recall on the standing map."
 *
 * Nothing is written to disk. MISSED_EDGE is LLM-only and reported not-testable.
 */
import type { ArchitectureComponent, ArchitectureConnection, NavGatorConfig, NavHashes } from '../types.js';
import { type AuditPlan } from './index.js';
import type { DefectClass } from './verifiers.js';
export interface SelfTestOptions {
    projectRoot: string;
    config: NavGatorConfig;
    /** Stored hashes (loaded by the caller). Null disables STALE_REFERENCE planting. */
    hashes?: NavHashes | null;
    /** Defects planted per class (default 10). */
    K?: number;
    plan?: AuditPlan;
    rand?: () => number;
    /** Mutation hook: stub these verifiers out to prove the self-test fails. */
    disabledVerifiers?: ReadonlyArray<DefectClass>;
    isMcpMode?: boolean;
    /** Minimum per-class recall to pass (default 0.9). */
    threshold?: number;
}
export interface SelfTestClassResult {
    class: DefectClass;
    testable: boolean;
    planted: number;
    detected: number;
    recall: number | null;
    missed_ids: string[];
    note?: string;
}
export interface SelfTestReport {
    K: number;
    plan: AuditPlan;
    threshold: number;
    pass: boolean;
    classes: SelfTestClassResult[];
    /** Plan power, independent of the plant. */
    sampling_power: {
        N_components: number;
        N_connections: number;
        n_components: number;
        n_connections: number;
        /** Probability one given defective component / connection is in the precision sample. */
        p_single_component: number;
        p_single_connection: number;
        /** Probability the c=0 screen (n=45) rejects a map whose true error rate is LTPD=5%. */
        screen_power_at_ltpd: number;
    };
    notes: string[];
    audit: {
        sampled: number;
        defects: number;
        verdict: string;
    };
}
export declare function runSelfTest(graph: {
    components: ReadonlyArray<ArchitectureComponent>;
    connections: ReadonlyArray<ArchitectureConnection>;
}, opts: SelfTestOptions): Promise<SelfTestReport>;
//# sourceMappingURL=self-test.d.ts.map