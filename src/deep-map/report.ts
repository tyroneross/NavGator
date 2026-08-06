/**
 * deep-map report — join manifest + ingest accounting + findings at READ time.
 *
 * Findings live only in `findings.jsonl` (written by `ingestRun`, see
 * `ingest.ts`) and are never folded back into `.navgator/architecture/`. This
 * module is the single place that performs the join, so `rm -rf
 * .navgator/deep-map` always restores a pure tier-0 install with nothing left
 * behind in the scanner's own store.
 */

import { readFindings, readIngestReport, readManifest } from './store.js';
import type { NavGatorConfig } from '../types.js';
import {
  ATTRIBUTION_NOTE,
  UNTRUSTED_SOURCE_NOTE,
  type DeepMapFinding,
  type DeepMapReport,
} from './types.js';

interface ComponentFindings {
  component_id: string;
  component_name: string;
  findings: DeepMapFinding[];
}

/**
 * Build the report for `runId`, or `null` when the run has no manifest —
 * either it was never planned or the run id does not exist.
 */
export function buildReport(
  runId: string,
  config?: NavGatorConfig,
  projectRoot?: string
): DeepMapReport | null {
  const manifest = readManifest(runId, config, projectRoot);
  if (!manifest) return null;

  const ingest = readIngestReport(runId, config, projectRoot);
  const allFindings = readFindings(runId, config, projectRoot);

  const byComponent = new Map<string, ComponentFindings>();
  const crossCutting: DeepMapFinding[] = [];
  for (const finding of allFindings) {
    if (finding.kind === 'cross-cutting') {
      crossCutting.push(finding);
      continue;
    }
    let entry = byComponent.get(finding.component_id);
    if (!entry) {
      entry = {
        component_id: finding.component_id,
        component_name: finding.component_name,
        findings: [],
      };
      byComponent.set(finding.component_id, entry);
    }
    entry.findings.push(finding);
  }

  const findingsByComponent = [...byComponent.values()].sort(
    (a, b) =>
      a.component_name.localeCompare(b.component_name) ||
      (a.component_id < b.component_id ? -1 : a.component_id > b.component_id ? 1 : 0)
  );

  const note = manifest.provenance.untrusted
    ? `${UNTRUSTED_SOURCE_NOTE}\n\n${ATTRIBUTION_NOTE}`
    : ATTRIBUTION_NOTE;

  return {
    schema_version: manifest.schema_version,
    run_id: manifest.run_id,
    project_path: manifest.project_path,
    graph: manifest.graph,
    tiers_planned: manifest.tiers_planned,
    cost: {
      packets_planned: manifest.packets.length,
      packets_returned: ingest?.packets_with_results ?? 0,
      estimated_input_tokens: manifest.cost.estimated_input_tokens,
      measured_output_bytes: ingest?.output_bytes ?? 0,
      findings_accepted: ingest?.accepted ?? allFindings.length,
      findings_rejected: ingest?.rejected ?? 0,
    },
    escalation: manifest.escalation?.escalated ?? [],
    findings_by_component: findingsByComponent,
    cross_cutting: crossCutting,
    rejections: ingest?.rejections ?? [],
    provenance: manifest.provenance,
    note,
  };
}
