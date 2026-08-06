/**
 * deep-map run store.
 *
 * Layout, alongside `.navgator/architecture/` and never inside it:
 *
 *   .navgator/deep-map/
 *     latest.json                       { run_id }
 *     runs/<run_id>/manifest.json
 *     runs/<run_id>/packets/<id>.json         written by NavGator
 *     runs/<run_id>/packets/<id>.result.json  written by the calling agent
 *     runs/<run_id>/findings.jsonl            validated, attributed
 *     runs/<run_id>/ingest.json               accept/reject accounting
 *
 * Keeping this tree separate from `architecture/` is what makes the LLM layer
 * removable: `rm -rf .navgator/deep-map` restores a pure tier-0 install, and no
 * scanner code reads anything under here.
 */
import { isContainedPath } from '../config.js';
import type { NavGatorConfig } from '../types.js';
import type { DeepMapFinding, DeepMapIngestReport, DeepMapManifest, DeepMapPacket } from './types.js';
/** Root of the deep-map tree: sibling of the architecture store. */
export declare function getDeepMapPath(config?: NavGatorConfig, projectRoot?: string): string;
export declare function getRunsPath(config?: NavGatorConfig, projectRoot?: string): string;
export declare function getRunPath(runId: string, config?: NavGatorConfig, projectRoot?: string): string;
export declare function getPacketsPath(runId: string, config?: NavGatorConfig, projectRoot?: string): string;
/**
 * True when `candidate` is `root` itself or lies beneath it.
 *
 * Re-exported from `config.ts` rather than reimplemented: two containment
 * checks in one codebase is how one of them ends up wrong, which is exactly
 * what had happened — `sanitizePath` used a bare `startsWith` that accepts
 * `/base-other` for a root of `/base`.
 */
export declare const isContained: typeof isContainedPath;
export declare function isValidRunId(runId: string): boolean;
/** `DM_<utc compact timestamp>_<8 hex>` — sortable, collision-resistant. */
export declare function generateRunId(now?: Date): string;
/** Packet ids are derived, never user-supplied, but stay path-safe by construction. */
export declare function makePacketId(tier: number, ordinal: number): string;
export declare function isValidPacketId(packetId: string): boolean;
export declare function writeManifest(manifest: DeepMapManifest, config?: NavGatorConfig, projectRoot?: string): string;
export declare function writePacket(packet: DeepMapPacket, config?: NavGatorConfig, projectRoot?: string): string;
export declare function writeLatest(runId: string, config?: NavGatorConfig, projectRoot?: string): void;
export declare function writeFindings(runId: string, findings: DeepMapFinding[], config?: NavGatorConfig, projectRoot?: string): string;
export declare function writeIngestReport(report: DeepMapIngestReport, config?: NavGatorConfig, projectRoot?: string): string;
export declare function readLatestRunId(config?: NavGatorConfig, projectRoot?: string): string | null;
export declare function readManifest(runId: string, config?: NavGatorConfig, projectRoot?: string): DeepMapManifest | null;
export declare function readIngestReport(runId: string, config?: NavGatorConfig, projectRoot?: string): DeepMapIngestReport | null;
export declare function readFindings(runId: string, config?: NavGatorConfig, projectRoot?: string): DeepMapFinding[];
export declare function listPacketFiles(runId: string, config?: NavGatorConfig, projectRoot?: string): string[];
export declare function readPacket(filePath: string): DeepMapPacket | null;
/**
 * Resolve a packet's result file, refusing anything that escapes the run's
 * packet directory. The packet id is validated first, so this is belt and
 * braces rather than the only guard.
 */
export declare function resultPathFor(runId: string, packetId: string, config?: NavGatorConfig, projectRoot?: string): string | null;
//# sourceMappingURL=store.d.ts.map