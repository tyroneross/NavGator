/**
 * `navgator deep-map` — tiered repo-mapping pipeline.
 *
 * Tier 0 is the existing deterministic scan. Tiers 1-3 are LLM passes run by
 * the CALLING agent (Claude Code / Codex), never by NavGator: this CLI emits
 * work packets, the host fans them out to subagents, and this CLI ingests +
 * validates + reports on what comes back. No LLM SDK, no model call, no
 * network — see `src/deep-map/types.ts`'s module header.
 *
 * Four subcommands, one pipeline stage each:
 *   plan    — partition the graph, optionally score escalation, write packets
 *   ingest  — validate `*.result.json` files the calling agent wrote back
 *   report  — join manifest + ingest accounting + findings at read time
 *   status  — is a fan-out actually done, or silently un-run?
 */

import * as fs from 'fs';
import { Command } from 'commander';

import { getConfig } from '../../config.js';
import { wrapInEnvelope } from '../../agent-output.js';
import { EXIT_CODES } from '../exit-codes.js';

import { loadTier0, resolveProvenance } from '../../deep-map/load.js';
import { partitionComponents } from '../../deep-map/partition.js';
import { scoreEscalation, DEFAULT_ESCALATION_FLOOR } from '../../deep-map/escalate.js';
import { buildReport } from '../../deep-map/report.js';
import {
  generateRunId,
  isValidRunId,
  listPacketFiles,
  readFindings,
  readIngestReport,
  readLatestRunId,
  readManifest,
  writeLatest,
  writeManifest,
  writePacket,
} from '../../deep-map/store.js';
import {
  DEEP_MAP_LIMITS,
  DEEP_MAP_SCHEMA_VERSION,
  type DeepMapCaps,
  type DeepMapFinding,
  type DeepMapIngestReport,
  type DeepMapManifest,
  type DeepMapPacket,
  type DeepMapPacketSummary,
  type DeepMapReport,
  type DeepMapTier,
  type EscalationResult,
  type PartitionResult,
} from '../../deep-map/types.js';

// Sibling modules written in parallel by other agents (docs/plans deep-map
// build). Signatures are frozen per the plan; coded against them directly —
// see this file's implementer report for anything that did not fit.
import { buildTier1Packets, buildTier2Packets, buildTier3Packet } from '../../deep-map/packets.js';
import { ingestRun } from '../../deep-map/ingest.js';

// =============================================================================
// SHARED OPTION TYPES + HELPERS
// =============================================================================

interface OutputOptions {
  json?: boolean;
  agent?: boolean;
}

interface PlanCommandOptions extends OutputOptions {
  tier: string[];
  maxPackets?: string;
  maxDeep?: string;
  minGroup?: string;
  maxNodes?: string;
  escalateThreshold?: string;
  exclude: string[];
  includeVendored?: boolean;
  run?: string;
}

interface IngestCommandOptions extends OutputOptions {
  run?: string;
}

interface ReportCommandOptions extends OutputOptions {
  run?: string;
}

interface StatusCommandOptions extends OutputOptions {
  run?: string;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat(value.split(',').map((v) => v.trim()).filter(Boolean));
}

/** Strict integer parse with an optional inclusive range. `undefined` input passes through as `null` (caller applies its own default). */
function parseIntOption(value: string | undefined, opts: { min?: number; max?: number } = {}): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

/** Same contract as `parseIntOption` but for the fractional escalation threshold. */
function parseFloatOption(value: string | undefined, opts: { min?: number; max?: number } = {}): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = parseFloat(trimmed);
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

function fail(exitCode: number, message: string): void {
  console.error(message);
  process.exitCode = exitCode;
}

function failUsage(message: string): void {
  fail(EXIT_CODES.USAGE, message);
}

function failNoData(message: string): void {
  fail(EXIT_CODES.NO_DATA, message);
}

function failNotFound(message: string): void {
  fail(EXIT_CODES.NOT_FOUND, message);
}

/** Validate `--run`, if given: malformed -> USAGE (caller returns), well-formed -> pass through. */
function validateRunOption(run: string | undefined): { ok: true; runId: string | undefined } | { ok: false } {
  if (run === undefined) return { ok: true, runId: undefined };
  if (!isValidRunId(run)) {
    failUsage(`invalid --run value: ${JSON.stringify(run)} (expected DM_<timestamp>_<hex>)`);
    return { ok: false };
  }
  return { ok: true, runId: run };
}

function resultPathForPacketFile(packetFile: string): string {
  return packetFile.replace(/\.json$/, '.result.json');
}

// =============================================================================
// REGISTRATION
// =============================================================================

export function registerDeepMapCommand(program: Command): void {
  const deepMap = program
    .command('deep-map')
    .description('Tiered repo-mapping pipeline — tier 0 deterministic, tiers 1-3 run by the calling agent');

  registerPlan(deepMap);
  registerIngest(deepMap);
  registerReport(deepMap);
  registerStatus(deepMap);
}

// =============================================================================
// plan
// =============================================================================

function registerPlan(deepMap: Command): void {
  deepMap
    .command('plan')
    .description('Partition the graph, optionally score escalation, and write deep-map work packets')
    .option('--tier <n>', 'Tier(s) to plan: 1, 2, 3 (repeatable or comma-separated)', collect, [])
    .option('--max-packets <n>', `Max tier-1 packets (default ${DEEP_MAP_LIMITS.maxPackets})`)
    .option('--max-deep <n>', `Max tier-2 escalated packets (default ${DEEP_MAP_LIMITS.maxDeep})`)
    .option('--min-group <n>', `Smallest community kept out of residual (default ${DEEP_MAP_LIMITS.minGroup})`)
    .option('--max-nodes <n>', `Max components per packet (default ${DEEP_MAP_LIMITS.nodesPerPacket})`)
    .option('--escalate-threshold <n>', `Escalation score floor (default ${DEFAULT_ESCALATION_FLOOR})`)
    .option('--exclude <glob>', 'Exclude glob, repeatable or comma-separated', collect, [])
    .option('--include-vendored', 'Skip the built-in vendor-directory exclusion')
    .option('--run <id>', 'Source run for tier-3 findings (default: latest run)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options: PlanCommandOptions) => {
      try {
        await runPlan(options);
      } catch (error) {
        console.error(`deep-map plan failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}

async function runPlan(options: PlanCommandOptions): Promise<void> {
  // ---- validate flags -------------------------------------------------
  const tierInputs = options.tier.length > 0 ? options.tier : ['1'];
  const tierSet = new Set<number>();
  for (const raw of tierInputs) {
    const n = parseIntOption(raw, { min: 1, max: 3 });
    if (n === null) {
      failUsage(`invalid --tier value: ${JSON.stringify(raw)} (must be 1, 2, or 3)`);
      return;
    }
    tierSet.add(n);
  }
  const tiers = [...tierSet].sort((a, b) => a - b) as DeepMapTier[];

  const maxPackets =
    options.maxPackets !== undefined
      ? parseIntOption(options.maxPackets, { min: 1 })
      : DEEP_MAP_LIMITS.maxPackets;
  if (maxPackets === null) {
    failUsage(`invalid --max-packets value: ${JSON.stringify(options.maxPackets)}`);
    return;
  }

  const maxDeep =
    options.maxDeep !== undefined ? parseIntOption(options.maxDeep, { min: 0 }) : DEEP_MAP_LIMITS.maxDeep;
  if (maxDeep === null) {
    failUsage(`invalid --max-deep value: ${JSON.stringify(options.maxDeep)}`);
    return;
  }

  const minGroup =
    options.minGroup !== undefined ? parseIntOption(options.minGroup, { min: 1 }) : DEEP_MAP_LIMITS.minGroup;
  if (minGroup === null) {
    failUsage(`invalid --min-group value: ${JSON.stringify(options.minGroup)}`);
    return;
  }

  const maxNodes =
    options.maxNodes !== undefined
      ? parseIntOption(options.maxNodes, { min: 1 })
      : DEEP_MAP_LIMITS.nodesPerPacket;
  if (maxNodes === null) {
    failUsage(`invalid --max-nodes value: ${JSON.stringify(options.maxNodes)}`);
    return;
  }

  const escalateThreshold =
    options.escalateThreshold !== undefined
      ? parseFloatOption(options.escalateThreshold, { min: 0 })
      : DEFAULT_ESCALATION_FLOOR;
  if (escalateThreshold === null) {
    failUsage(`invalid --escalate-threshold value: ${JSON.stringify(options.escalateThreshold)}`);
    return;
  }

  const sourceRunValidation = validateRunOption(options.run);
  if (!sourceRunValidation.ok) return;

  // ---- load tier 0 ------------------------------------------------------
  const config = getConfig();
  const tier0 = await loadTier0(config);
  if (tier0.empty) {
    failNoData('No scan data found — run `navgator scan` first.');
    return;
  }

  const filterOptions = {
    exclude: options.exclude,
    includeVendored: Boolean(options.includeVendored),
  };

  const partition: PartitionResult = partitionComponents(tier0.components, tier0.connections, tier0.metrics, {
    ...filterOptions,
    minGroup,
    maxNodesPerPacket: maxNodes,
    maxPackets,
  });

  let escalation: EscalationResult | null = null;
  if (tiers.includes(2)) {
    escalation = scoreEscalation(
      {
        components: tier0.components,
        connections: tier0.connections,
        metrics: tier0.metrics,
        violations: tier0.violations,
        fileMap: tier0.fileMap,
      },
      { ...filterOptions, threshold: escalateThreshold, maxDeep }
    );
  }

  // Continue an existing run when the caller names one, rather than minting a
  // fresh id per tier. The documented sequence is `plan --tier 1` → ingest →
  // `plan --tier 2` → ingest → `plan --tier 3`; minting a run per invocation
  // meant tier 3 read only the most recent run's findings and silently dropped
  // every tier-1 finding, while `status` and `report` each described a fragment
  // of the pipeline. One run now holds all of its tiers.
  const existingManifest = sourceRunValidation.runId
    ? readManifest(sourceRunValidation.runId, config)
    : null;
  const runId = existingManifest?.run_id ?? generateRunId();
  const continuingRun = existingManifest !== null;
  const provenance = await resolveProvenance(process.cwd());

  const packetInput = {
    runId,
    components: tier0.components,
    connections: tier0.connections,
    partition,
    escalation,
    fileMap: tier0.fileMap,
    provenance,
  };

  const packets: DeepMapPacket[] = [];
  if (tiers.includes(1)) {
    packets.push(...buildTier1Packets(packetInput));
  }
  if (tiers.includes(2)) {
    packets.push(...buildTier2Packets(packetInput));
  }
  if (tiers.includes(3)) {
    const sourceRunId = sourceRunValidation.runId ?? readLatestRunId(config) ?? undefined;
    if (!sourceRunId) {
      failNoData(
        'Tier 3 needs findings ingested from a prior run — no run found. Pass --run <id> or run ' +
          '`navgator deep-map plan --tier 1` (and ingest it) first.'
      );
      return;
    }
    const priorFindings = readFindings(sourceRunId, config);
    if (priorFindings.length === 0) {
      failNoData(
        `Tier 3 needs ingested tier-1/2 findings for run ${sourceRunId} — run ` +
          `\`navgator deep-map ingest --run ${sourceRunId}\` first.`
      );
      return;
    }
    const tier3Packet = buildTier3Packet(packetInput, priorFindings);
    if (tier3Packet) packets.push(tier3Packet);
  }

  // ---- write run ----------------------------------------------------------
  for (const packet of packets) writePacket(packet, config);

  const totalEstimatedTokens = packets.reduce((sum, p) => sum + p.estimated_input_tokens, 0);
  const packetSummaries: DeepMapPacketSummary[] = packets.map((p) => ({
    packet_id: p.packet_id,
    tier: p.tier,
    group_label: p.group_label,
    components: p.components.length,
    edges: p.edges.length,
    estimated_input_tokens: p.estimated_input_tokens,
  }));

  const caps: DeepMapCaps = {
    max_packets: maxPackets,
    max_deep: maxDeep,
    truncated: partition.truncated > 0,
    ...(partition.truncated > 0
      ? { truncation_note: `${partition.truncated} group(s) dropped after reaching --max-packets (${maxPackets})` }
      : {}),
  };

  const communities =
    !tier0.metrics || tier0.metrics.suppressed
      ? 0
      : new Set(tier0.metrics.metrics.map((m) => m.community_id)).size;

  const manifest: DeepMapManifest = {
    schema_version: DEEP_MAP_SCHEMA_VERSION,
    run_id: runId,
    created_at: Date.now(),
    project_path: provenance.project_path,
    tiers_planned: tiers,
    graph: {
      components: tier0.components.length,
      internal_components: partition.considered,
      connections: tier0.connections.length,
      communities,
      metrics_suppressed: tier0.metrics?.suppressed ?? true,
    },
    partition: {
      unit: partition.unit,
      groups: partition.groups.length,
      min_group: partition.min_group,
      max_nodes_per_packet: partition.max_nodes_per_packet,
      residual_components: partition.residual_components,
      reason: partition.reason,
    },
    escalation,
    caps,
    packets: packetSummaries,
    cost: { packets: packets.length, estimated_input_tokens: totalEstimatedTokens },
    provenance,
  };

  if (continuingRun && existingManifest) {
    // Preserve what earlier tiers recorded: their packet summaries, their
    // planned tiers, and the run's original creation time.
    manifest.created_at = existingManifest.created_at;
    manifest.tiers_planned = [...new Set([...existingManifest.tiers_planned, ...tiers])].sort();
    const known = new Set(packetSummaries.map((p) => p.packet_id));
    manifest.packets = [
      ...existingManifest.packets.filter((p) => !known.has(p.packet_id)),
      ...packetSummaries,
    ];
    manifest.cost = {
      packets: manifest.packets.length,
      estimated_input_tokens: manifest.packets.reduce(
        (sum, p) => sum + p.estimated_input_tokens,
        0
      ),
    };
    if (!escalation && existingManifest.escalation) manifest.escalation = existingManifest.escalation;
  }

  writeManifest(manifest, config);
  writeLatest(runId, config);

  const payload = {
    run_id: runId,
    tiers_planned: tiers,
    packets: packetSummaries,
    partition: manifest.partition,
    filter: partition.filter,
    escalation,
    caps,
    cost: manifest.cost,
    provenance,
  };

  if (options.agent) {
    console.log(wrapInEnvelope('deep-map plan', payload));
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printPlanHuman(runId, packets, partition, escalation, totalEstimatedTokens);
}

function printPlanHuman(
  runId: string,
  packets: DeepMapPacket[],
  partition: PartitionResult,
  escalation: EscalationResult | null,
  totalEstimatedTokens: number
): void {
  const prefixByLabel = new Map(partition.groups.map((g) => [g.label, g.path_prefix]));

  console.log(`deep-map plan — run ${runId}`);
  console.log(`${packets.length} packet(s)`);
  console.log('');
  for (const p of packets) {
    const prefix = prefixByLabel.get(p.group_label) ?? '';
    console.log(
      `  ${p.packet_id}  ${p.group_label}  ${p.components.length} components  ~${p.estimated_input_tokens} tokens  ${prefix}`
    );
  }

  if (escalation) {
    console.log('');
    console.log(`Escalation (threshold ${escalation.threshold}, ${escalation.escalated.length} of ${escalation.considered} escalated):`);
    for (const e of escalation.escalated) {
      console.log(`  ${e.name}  score ${e.score.toFixed(3)}`);
      for (const reason of e.reasons) console.log(`    - ${reason}`);
    }
  }

  console.log('');
  console.log(
    `Filter: excluded_vendor=${partition.filter.excluded_vendor}  excluded_glob=${partition.filter.excluded_glob}  ` +
      `suspect_vendored=${partition.filter.suspect_vendored}`
  );

  console.log('');
  console.log(`Total estimated input tokens: ${totalEstimatedTokens}`);
  console.log('');
  console.log(
    `Next: fan each packet out to a subagent, write its result to <packet_id>.result.json, then run ` +
      `\`navgator deep-map ingest --run ${runId}\`.`
  );
}

// =============================================================================
// ingest
// =============================================================================

function registerIngest(deepMap: Command): void {
  deepMap
    .command('ingest')
    .description('Validate *.result.json files the calling agent wrote back for a run')
    .option('--run <id>', 'Run id (default: latest)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options: IngestCommandOptions) => {
      try {
        await runIngest(options);
      } catch (error) {
        console.error(`deep-map ingest failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}

async function runIngest(options: IngestCommandOptions): Promise<void> {
  const validated = validateRunOption(options.run);
  if (!validated.ok) return;

  const config = getConfig();
  const runId = validated.runId ?? readLatestRunId(config) ?? undefined;
  if (!runId) {
    failNoData('No deep-map run found — run `navgator deep-map plan` first.');
    return;
  }

  const manifest = readManifest(runId, config);
  if (!manifest) {
    failNotFound(`unknown deep-map run: ${runId}`);
    return;
  }

  const packetFiles = listPacketFiles(runId, config);
  const hasAnyResult = packetFiles.some((f) => fs.existsSync(resultPathForPacketFile(f)));
  if (!hasAnyResult) {
    failNoData(`No *.result.json files found for run ${runId} — nothing to ingest yet.`);
    return;
  }

  const tier0 = await loadTier0(config);
  const knownComponentIds = new Map(tier0.components.map((c) => [c.component_id, c.name]));
  const knownFilePaths = new Set(Object.keys(tier0.fileMap));

  const { report } = ingestRun({ runId, knownComponentIds, knownFilePaths, config });

  if (options.agent) {
    console.log(wrapInEnvelope('deep-map ingest', report));
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printIngestHuman(report);
}

function printIngestHuman(report: DeepMapIngestReport): void {
  console.log(`deep-map ingest — run ${report.run_id}`);
  console.log(`Packets seen: ${report.packets_seen}  with results: ${report.packets_with_results}`);
  console.log(`Accepted: ${report.accepted}  Rejected: ${report.rejected}`);
  if (report.rejections.length > 0) {
    console.log('Rejections:');
    for (const r of report.rejections) {
      console.log(`  ${r.packet_id}  ${r.reason}  ${r.detail}`);
    }
  }
}

// =============================================================================
// report
// =============================================================================

function registerReport(deepMap: Command): void {
  deepMap
    .command('report')
    .description('Join manifest + ingest accounting + findings for a run')
    .option('--run <id>', 'Run id (default: latest)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options: ReportCommandOptions) => {
      try {
        await runReport(options);
      } catch (error) {
        console.error(`deep-map report failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}

async function runReport(options: ReportCommandOptions): Promise<void> {
  const validated = validateRunOption(options.run);
  if (!validated.ok) return;

  const config = getConfig();
  const runId = validated.runId ?? readLatestRunId(config) ?? undefined;
  if (!runId) {
    failNoData('No deep-map run found — run `navgator deep-map plan` first.');
    return;
  }

  const report = buildReport(runId, config);
  if (!report) {
    failNotFound(`unknown deep-map run: ${runId}`);
    return;
  }

  if (report.findings_by_component.length === 0 && report.cross_cutting.length === 0) {
    failNoData(
      `Run ${runId} has no findings yet — run \`navgator deep-map ingest --run ${runId}\` first.`
    );
    return;
  }

  if (options.agent) {
    console.log(wrapInEnvelope('deep-map report', report));
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReportHuman(report);
}

function printReportHuman(report: DeepMapReport): void {
  console.log(`deep-map report — run ${report.run_id}`);
  console.log('');
  console.log('Cost');
  console.log(`  Packets planned:            ${report.cost.packets_planned}`);
  console.log(`  Packets returned:           ${report.cost.packets_returned}`);
  console.log(`  Estimated input tokens:     ${report.cost.estimated_input_tokens}`);
  console.log(`  Measured output bytes:      ${report.cost.measured_output_bytes}`);
  console.log(`  Findings accepted/rejected: ${report.cost.findings_accepted}/${report.cost.findings_rejected}`);

  if (report.escalation.length > 0) {
    console.log('');
    console.log(`Escalation (${report.escalation.length}):`);
    for (const e of report.escalation) {
      console.log(`  ${e.name}  score ${e.score.toFixed(3)}`);
    }
  }

  console.log('');
  console.log(report.note);

  console.log('');
  console.log(`Findings by component (${report.findings_by_component.length}):`);
  for (const entry of report.findings_by_component) {
    console.log(`  ${entry.component_name} (${entry.component_id})`);
    for (const f of entry.findings) {
      console.log(`    [${f.kind}] ${f.text}`);
    }
  }

  if (report.cross_cutting.length > 0) {
    console.log('');
    console.log(report.note);
    console.log(`Cross-cutting findings (${report.cross_cutting.length}):`);
    for (const f of report.cross_cutting) {
      console.log(`  [${f.kind}] ${f.text}`);
    }
  }

  if (report.rejections.length > 0) {
    console.log('');
    console.log(`Rejections (${report.rejections.length}):`);
    for (const r of report.rejections) {
      console.log(`  ${r.packet_id}  ${r.reason}  ${r.detail}`);
    }
  }
}

// =============================================================================
// status
// =============================================================================

function registerStatus(deepMap: Command): void {
  deepMap
    .command('status')
    .description('Report whether a fan-out is actually done, or silently un-run')
    .option('--run <id>', 'Run id (default: latest)')
    .option('--json', 'Output as JSON')
    .option('--agent', 'Output wrapped in agent envelope (implies --json)')
    .action(async (options: StatusCommandOptions) => {
      try {
        await runStatus(options);
      } catch (error) {
        console.error(`deep-map status failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.OPERATIONAL;
      }
    });
}

async function runStatus(options: StatusCommandOptions): Promise<void> {
  const validated = validateRunOption(options.run);
  if (!validated.ok) return;

  const config = getConfig();
  const runId = validated.runId ?? readLatestRunId(config) ?? undefined;
  if (!runId) {
    failNoData('No deep-map run found — run `navgator deep-map plan` first.');
    return;
  }

  const manifest = readManifest(runId, config);
  if (!manifest) {
    failNotFound(`unknown deep-map run: ${runId}`);
    return;
  }

  const packetFiles = listPacketFiles(runId, config);
  const withResults = packetFiles.filter((f) => fs.existsSync(resultPathForPacketFile(f))).length;
  const ingestReport = readIngestReport(runId, config);

  const payload = {
    run_id: runId,
    tiers_planned: manifest.tiers_planned,
    packets_planned: manifest.packets.length,
    packets_with_results: withResults,
    packets_without_results: manifest.packets.length - withResults,
    ingested: ingestReport !== null,
    ingest_report: ingestReport,
  };

  if (options.agent) {
    console.log(wrapInEnvelope('deep-map status', payload));
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`deep-map status — run ${payload.run_id}`);
  console.log(`Tiers planned: ${payload.tiers_planned.join(', ')}`);
  console.log(
    `Packets: ${payload.packets_with_results}/${payload.packets_planned} have results ` +
      `(${payload.packets_without_results} pending)`
  );
  console.log(`Ingested: ${payload.ingested ? 'yes' : 'no'}`);
}
