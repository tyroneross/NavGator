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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ArchitectureComponent,
  ArchitectureConnection,
  ComponentType,
  NavHashes,
} from '../types.js';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type DefectClass =
  | 'HALLUCINATED_COMPONENT'
  | 'HALLUCINATED_EDGE'
  | 'WRONG_ENDPOINT'
  | 'STALE_REFERENCE'
  | 'DEDUP_COLLISION'
  | 'MISSED_EDGE';

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

// Code-level component types whose `code_reference.symbol` should appear in
// the recorded source file.
const CODE_COMPONENT_TYPES = new Set<ComponentType>([
  'api-endpoint',
  'prompt',
  'worker',
  'component',
]);

// ============================================================================
// HELPERS
// ============================================================================

async function readFileSafe(absPath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.promises.access(absPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(absPath: string): Promise<string | null> {
  try {
    const buf = await fs.promises.readFile(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

// ============================================================================
// V1 — HALLUCINATED_COMPONENT
// ============================================================================

export async function verifyHallucinatedComponent(
  samples: ReadonlyArray<ArchitectureComponent>,
  ctx: VerifierContext
): Promise<VerifierOutcome> {
  const evidence: SampleEvidence[] = [];

  for (const comp of samples) {
    const configFiles = comp.source?.config_files ?? [];
    if (configFiles.length === 0) {
      // No config_files claim → can't verify, mark as ok.
      evidence.push({ id: comp.component_id, ok: true });
      continue;
    }

    // At least one config file must exist on disk.
    let anyExists = false;
    for (const rel of configFiles) {
      const abs = path.isAbsolute(rel) ? rel : path.join(ctx.projectRoot, rel);
      if (await fileExists(abs)) {
        anyExists = true;
        break;
      }
    }

    if (!anyExists) {
      evidence.push({
        id: comp.component_id,
        ok: false,
        reason: `none of ${configFiles.length} config_files exist on disk`,
      });
      continue;
    }

    // For code-level component types, check the symbol appears in the file.
    // Skip cleanly if symbol is missing or generic.
    if (CODE_COMPONENT_TYPES.has(comp.type) && configFiles[0]) {
      const sym = (comp as { code_reference?: { symbol?: string } }).code_reference?.symbol;
      // ArchitectureComponent doesn't carry code_reference directly; this is a
      // permissive check — only fail if we can confidently say "symbol absent".
      if (sym && sym.length > 1 && /^[A-Za-z_][\w$]*$/.test(sym)) {
        const abs = path.join(ctx.projectRoot, configFiles[0]);
        const content = await readFileSafe(abs);
        if (content !== null && !content.includes(sym)) {
          evidence.push({
            id: comp.component_id,
            ok: false,
            reason: `symbol "${sym}" not found in ${configFiles[0]}`,
          });
          continue;
        }
      }
    }

    evidence.push({ id: comp.component_id, ok: true });
  }

  return {
    class: 'HALLUCINATED_COMPONENT',
    sampledCount: samples.length,
    defectCount: evidence.filter((e) => !e.ok).length,
    samples: evidence,
  };
}

// ============================================================================
// V2 — HALLUCINATED_EDGE
// ============================================================================

export function verifyHallucinatedEdge(
  samples: ReadonlyArray<ArchitectureConnection>,
  ctx: VerifierContext
): VerifierOutcome {
  const evidence: SampleEvidence[] = samples.map((conn) => {
    const fromOk = ctx.componentById.has(conn.from?.component_id ?? '');
    const toOk = ctx.componentById.has(conn.to?.component_id ?? '');
    if (fromOk && toOk) return { id: conn.connection_id, ok: true };
    return {
      id: conn.connection_id,
      ok: false,
      reason: !fromOk && !toOk
        ? 'both endpoints unresolved'
        : !fromOk
        ? `from.component_id "${conn.from?.component_id}" unresolved`
        : `to.component_id "${conn.to?.component_id}" unresolved`,
    };
  });

  return {
    class: 'HALLUCINATED_EDGE',
    sampledCount: samples.length,
    defectCount: evidence.filter((e) => !e.ok).length,
    samples: evidence,
  };
}

// ============================================================================
// V3 — WRONG_ENDPOINT
// ============================================================================

/**
 * Re-checks that the connection's recorded source file still contains a
 * reference to the target component's name (or the symbol). Cheap grep —
 * not a syntactic AST check.
 */
export async function verifyWrongEndpoint(
  samples: ReadonlyArray<ArchitectureConnection>,
  ctx: VerifierContext
): Promise<VerifierOutcome> {
  const evidence: SampleEvidence[] = [];

  for (const conn of samples) {
    const filePath = conn.code_reference?.file;
    if (!filePath) {
      evidence.push({ id: conn.connection_id, ok: true });
      continue;
    }
    const abs = path.join(ctx.projectRoot, filePath);
    const content = await readFileSafe(abs);
    if (content === null) {
      // File missing → covered by stale-ref or hallucinated-component;
      // not a wrong-endpoint defect by our definition.
      evidence.push({ id: conn.connection_id, ok: true });
      continue;
    }

    const target = ctx.componentById.get(conn.to?.component_id ?? '');
    const symbol = conn.code_reference?.symbol;
    const targetName = target?.name;

    // We need at least ONE positive signal. Try (in order):
    //   1. recorded symbol appears in the file
    //   2. target component name appears in the file
    let found = false;
    const tried: string[] = [];

    if (symbol && symbol.length > 1) {
      tried.push(`symbol="${symbol}"`);
      const re = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
      if (re.test(content)) found = true;
    }
    if (!found && targetName && targetName.length > 1) {
      tried.push(`name="${targetName}"`);
      // Names can be paths like "@scope/pkg" — not always identifiers.
      if (content.includes(targetName)) found = true;
    }

    if (!found && tried.length > 0) {
      evidence.push({
        id: conn.connection_id,
        ok: false,
        reason: `no reference to ${tried.join(' or ')} in ${filePath}`,
      });
    } else {
      evidence.push({ id: conn.connection_id, ok: true });
    }
  }

  return {
    class: 'WRONG_ENDPOINT',
    sampledCount: samples.length,
    defectCount: evidence.filter((e) => !e.ok).length,
    samples: evidence,
  };
}

// ============================================================================
// V4 — STALE_REFERENCE
// ============================================================================

export async function verifyStaleReference(
  /** Sampled FILES (relative paths), not components. */
  sampledFiles: ReadonlyArray<string>,
  ctx: VerifierContext
): Promise<VerifierOutcome> {
  const evidence: SampleEvidence[] = [];

  if (!ctx.hashes || !ctx.hashes.files) {
    return {
      class: 'STALE_REFERENCE',
      sampledCount: sampledFiles.length,
      defectCount: 0,
      samples: sampledFiles.map((f) => ({ id: f, ok: true })),
    };
  }

  for (const rel of sampledFiles) {
    const recorded = ctx.hashes.files[rel];
    if (!recorded) {
      // Not in hashes.json → can't compare; not stale by definition.
      evidence.push({ id: rel, ok: true });
      continue;
    }
    const abs = path.join(ctx.projectRoot, rel);
    const current = await sha256File(abs);
    if (current === null) {
      // File deleted since scan → stale ref
      evidence.push({ id: rel, ok: false, reason: 'file no longer exists on disk' });
      continue;
    }
    if (current !== recorded.hash) {
      evidence.push({
        id: rel,
        ok: false,
        reason: `hash mismatch (recorded ${recorded.hash.slice(0, 8)}…, now ${current.slice(0, 8)}…)`,
      });
    } else {
      evidence.push({ id: rel, ok: true });
    }
  }

  return {
    class: 'STALE_REFERENCE',
    sampledCount: sampledFiles.length,
    defectCount: evidence.filter((e) => !e.ok).length,
    samples: evidence,
  };
}

// ============================================================================
// V5 — DEDUP_COLLISION (regression check on Run 1.7 fix)
// ============================================================================

/**
 * Scans ALL components (not a sample — this is a graph-wide invariant) for
 * duplicate (type, name, primary-config-file) triples. Returns one evidence
 * row per collision pair.
 */
export function verifyDedupCollision(
  allComponents: ReadonlyArray<ArchitectureComponent>
): VerifierOutcome {
  const seen = new Map<string, ArchitectureComponent>();
  const evidence: SampleEvidence[] = [];

  for (const c of allComponents) {
    const primary = c.source?.config_files?.[0] ?? '__none';
    const key = `${c.type}|${c.name}|${primary}`;
    const prior = seen.get(key);
    if (prior) {
      evidence.push({
        id: c.component_id,
        ok: false,
        reason: `dedup-key collision with ${prior.component_id} on (${c.type}, ${c.name}, ${primary})`,
      });
    } else {
      seen.set(key, c);
    }
  }

  // Don't generate ok-evidence for every component — only collisions.
  return {
    class: 'DEDUP_COLLISION',
    sampledCount: allComponents.length,
    defectCount: evidence.length,
    samples: evidence,
  };
}

// ============================================================================
// V6 — MISSED_EDGE (LLM-judge — MCP only)
// ============================================================================

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
export function verifyMissedEdge(
  sampledFiles: ReadonlyArray<string>,
  allConnections: ReadonlyArray<ArchitectureConnection>,
  ctx: VerifierContext
): VerifierOutcome {
  if (!ctx.isMcpMode) {
    return {
      class: 'MISSED_EDGE',
      sampledCount: sampledFiles.length,
      defectCount: 0,
      samples: sampledFiles.map((f) => ({ id: f, ok: true, reason: 'llm-skipped' })),
      llm_skipped: true,
    };
  }

  // Build per-file edge map.
  const byFile = new Map<string, ArchitectureConnection[]>();
  for (const conn of allConnections) {
    const f = conn.code_reference?.file;
    if (!f) continue;
    let arr = byFile.get(f);
    if (!arr) {
      arr = [];
      byFile.set(f, arr);
    }
    arr.push(conn);
  }

  const payload: MissedEdgePayload = {
    instruction:
      'For each file, list all outgoing dependencies (imports, API calls, db queries, queue producers, LLM calls). ' +
      'Set-diff against `recorded_outgoing_edges`. Return any dependency in the file that is NOT in the recorded list.',
    files: sampledFiles.map((rel) => ({
      path: rel,
      recorded_outgoing_edges: (byFile.get(rel) ?? []).map((c) => ({
        connection_id: c.connection_id,
        target_component_id: c.to?.component_id ?? '',
        target_name: ctx.componentById.get(c.to?.component_id ?? '')?.name,
        symbol: c.code_reference?.symbol,
      })),
    })),
  };

  // The LLM judge runs out-of-band; we mark all samples ok pending its reply.
  // The MCP transport is responsible for re-injecting the verdict into the
  // audit report on a follow-up tool call.
  return {
    class: 'MISSED_EDGE',
    sampledCount: sampledFiles.length,
    defectCount: 0,
    samples: sampledFiles.map((f) => ({ id: f, ok: true, reason: 'awaiting-llm-verdict' })),
    llm_payload: payload,
  };
}
