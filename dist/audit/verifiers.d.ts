/**
 * NavGator audit verifiers — Run 2 / D2
 *
 * Six defect classes. First five are deterministic (free); MISSED_EDGE
 * is the only LLM-dependent one (skipped in CLI mode).
 *
 *   HALLUCINATED_COMPONENT — claimed component does not exist on disk
 *   HALLUCINATED_EDGE      — connection's endpoints not in component graph
 *   WRONG_ENDPOINT         — symbol not actually present in source file
 *   STALE_REFERENCE        — file hash doesn't match recorded hash
 *   DEDUP_COLLISION        — same (type,name,primary-config) appears twice
 *   MISSED_EDGE            — LLM-only; emits a needs-verification payload
 */
import type { ArchitectureComponent, ArchitectureConnection, NavHashes } from '../types.js';
export type DefectClass = 'HALLUCINATED_COMPONENT' | 'HALLUCINATED_EDGE' | 'WRONG_ENDPOINT' | 'STALE_REFERENCE' | 'DEDUP_COLLISION' | 'MISSED_EDGE';
export interface SampleEvidence {
    /** Component or connection id. */
    id: string;
    /** True if the verifier passes (no defect). */
    ok: boolean;
    /** When ok=false, machine-readable reason. */
    reason?: string;
}
export interface VerifierOutcome {
    class: DefectClass;
    sampledCount: number;
    defectCount: number;
    samples: SampleEvidence[];
    /** Set on MISSED_EDGE in CLI mode. */
    llm_skipped?: boolean;
    /** When llm_skipped=false, the structured payload that an MCP-side LLM judge
     *  is expected to consume.  Shape: { files: [{path, recorded_outgoing_edges}] }. */
    llm_payload?: unknown;
}
export interface VerifierContext {
    projectRoot: string;
    hashes: NavHashes | null;
    /** O(1) lookup: component_id → component. */
    componentById: Map<string, ArchitectureComponent>;
    /** Whether this is an MCP session (LLM-judge enabled). */
    isMcpMode: boolean;
}
export declare function verifyHallucinatedComponent(samples: ReadonlyArray<ArchitectureComponent>, ctx: VerifierContext): Promise<VerifierOutcome>;
export declare function verifyHallucinatedEdge(samples: ReadonlyArray<ArchitectureConnection>, ctx: VerifierContext): VerifierOutcome;
/**
 * Re-checks that the connection's recorded source file still contains a
 * reference to the target component's name (or the symbol). Cheap grep —
 * not a syntactic AST check.
 */
export declare function verifyWrongEndpoint(samples: ReadonlyArray<ArchitectureConnection>, ctx: VerifierContext): Promise<VerifierOutcome>;
export declare function verifyStaleReference(
/** Sampled FILES (relative paths), not components. */
sampledFiles: ReadonlyArray<string>, ctx: VerifierContext): Promise<VerifierOutcome>;
/**
 * Scans ALL components (not a sample — this is a graph-wide invariant) for
 * duplicate (type, name, primary-config-file) triples. Returns one evidence
 * row per collision pair.
 */
export declare function verifyDedupCollision(allComponents: ReadonlyArray<ArchitectureComponent>): VerifierOutcome;
export interface MissedEdgePayload {
    files: Array<{
        path: string;
        recorded_outgoing_edges: Array<{
            connection_id: string;
            target_component_id: string;
            target_name: string | undefined;
            symbol: string | undefined;
        }>;
    }>;
    /** Instruction for the LLM judge. */
    instruction: string;
}
/**
 * Build a structured payload describing each sampled file's recorded outgoing
 * edges, for an MCP-side LLM judge to set-diff against the file contents.
 *
 * In CLI mode we set `llm_skipped: true` and return zero defects; the audit
 * report flags the skip but doesn't fail.
 */
export declare function verifyMissedEdge(sampledFiles: ReadonlyArray<string>, allConnections: ReadonlyArray<ArchitectureConnection>, ctx: VerifierContext): VerifierOutcome;
//# sourceMappingURL=verifiers.d.ts.map