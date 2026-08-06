/**
 * deep-map ingest — turns `*.result.json` files into validated, attributed
 * findings.
 *
 * The CALLING agent (Claude Code, Codex, ...) fans an LLM out over the work
 * packets this engine emits and writes each answer to
 * `<run>/packets/<packet_id>.result.json`. This module is the only place that
 * reads those files, and its whole job is a security boundary: **model output
 * can never alter what tier 0 found.** Every byte of a result file is treated
 * as untrusted data, because the scanned repo may itself be someone else's
 * GitHub project (`navgator scan-remote`) — component names and file paths
 * inside a result file are then attacker-authored strings, not facts.
 *
 * The anti-hallucination join: a finding whose `component_id` does not exist
 * in tier 0's own component set is rejected and counted, never coerced into
 * existing, never silently dropped.
 *
 * No LLM SDK, no model call, no network — this only reads and validates files
 * already on disk.
 */
import type { NavGatorConfig } from '../types.js';
import { type DeepMapFinding, type DeepMapIngestReport, type DeepMapRejection, type DeepMapTier } from './types.js';
export interface IngestOptions {
    runId: string;
    /** Valid tier-0 component ids. A finding naming anything outside this set is rejected. */
    knownComponentIds: Map<string, string>;
    /** Real repo file paths from file_map.json, used to check evidence is grounded. */
    knownFilePaths: Set<string>;
    config?: NavGatorConfig;
    projectRoot?: string;
    /** When false, skip writing findings.jsonl / ingest.json (used by tests + a dry run). */
    persist?: boolean;
}
export interface IngestResult {
    report: DeepMapIngestReport;
    findings: DeepMapFinding[];
}
/**
 * Validate one packet's already-parsed result payload. Exported so validation
 * logic is directly testable without touching disk.
 */
export declare function validateResultPayload(raw: unknown, packet: {
    packet_id: string;
    tier: DeepMapTier;
    run_id: string;
    component_ids: string[];
}, options: Pick<IngestOptions, 'knownComponentIds' | 'knownFilePaths'>): {
    findings: DeepMapFinding[];
    rejections: DeepMapRejection[];
};
/**
 * Ingest every result file present for a run: validate, sanitize, attribute,
 * and (unless `persist: false`) write `findings.jsonl` + `ingest.json`.
 *
 * Walks the packets directory itself rather than only the dispatched-packet
 * list, so a `*.result.json` naming a packet id nobody dispatched is caught
 * as `unknown_packet` instead of silently ignored.
 */
export declare function ingestRun(options: IngestOptions): IngestResult;
//# sourceMappingURL=ingest.d.ts.map