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
/**
 * Strip every ASCII control character, including tab, newline, and carriage
 * return, and cap the length.
 *
 * This is the outbound half of the trust boundary, and it was missing. `ingest`
 * sanitises what a model sends back; nothing sanitised what NavGator sends out.
 * Component names and file paths are derived from the SCANNED REPO, which
 * `navgator scan-remote <url>` will happily clone from any stranger on GitHub —
 * a file named so that its path contains a newline followed by instruction text
 * produces a prompt line that is structurally indistinguishable from NavGator's
 * own instructions, executed by a coding agent holding the user's tool
 * permissions.
 *
 * Applied unconditionally, never gated on `provenance.untrusted`. Provenance
 * detection can fail open in several ways, and a repo the user cloned by hand
 * is `origin: 'local'` while being just as much someone else's code.
 */
export declare function sanitizeForPrompt(input: string, max?: number): string;
export declare function buildTier1Packets(input: BuildPacketsInput): DeepMapPacket[];
export declare function buildTier2Packets(input: BuildPacketsInput): DeepMapPacket[];
export declare function buildTier3Packet(input: BuildPacketsInput, findings: DeepMapFinding[]): DeepMapPacket | null;
//# sourceMappingURL=packets.d.ts.map