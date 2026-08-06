/**
 * deep-map — tier 1/2/3 work-packet construction.
 *
 * NavGator never calls a model: this module turns tier-0 facts (components,
 * connections, the partition, the escalation scores) into deterministic,
 * ready-to-send prompts. The CALLING agent sends each packet's `prompt` to
 * whatever model it has access to and writes the result back next to the
 * packet; `ingest.ts` (not this file) validates what comes back.
 *
 * Determinism is a hard requirement, not a nicety — packets get diffed and
 * re-sent across sessions, and a byte-different prompt for the same input
 * would silently invalidate any caching or resumability built on top of this.
 * So: no timestamps, no random ids, no relying on Map/Set/Object iteration
 * order — every list that isn't already deterministically ordered by an
 * upstream module (`partition.ts`, `escalate.ts`) is sorted explicitly here.
 */
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import { type DeepMapFinding, type DeepMapPacket, type DeepMapProvenance, type EscalationResult, type PartitionResult } from './types.js';
export interface BuildPacketsInput {
    runId: string;
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
    partition: PartitionResult;
    escalation: EscalationResult | null;
    /** file path -> component_id */
    fileMap: Record<string, string>;
    provenance: DeepMapProvenance;
}
/** Serialized prompt chars / 4 — an estimate, and labelled as one everywhere it surfaces. */
export declare function estimateInputTokens(prompt: string): number;
export declare function buildTier1Packets(input: BuildPacketsInput): DeepMapPacket[];
export declare function buildTier2Packets(input: BuildPacketsInput): DeepMapPacket[];
export declare function buildTier3Packet(input: BuildPacketsInput, findings: DeepMapFinding[]): DeepMapPacket | null;
//# sourceMappingURL=packets.d.ts.map