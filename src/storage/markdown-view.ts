/**
 * Markdown view layer (T3, trimmed).
 *
 * Derives a human-readable markdown projection of each component into
 * `<storage>/components-md/<type>/<slug>.md`. JSON files remain the
 * canonical source of truth — these markdown files are pure derivatives,
 * regenerated on every scan.
 *
 * Why this exists:
 *   - Obsidian/Foam render YAML frontmatter + [[wikilinks]] natively
 *   - Git diffs of markdown components are far more readable than JSON
 *   - ripgrep targets for fuzzy search (`navgator find`) become trivial
 *
 * Why NOT a full migration to markdown-as-source:
 *   - storage.ts is 1500+ lines with 50+ consumers reading JSON
 *   - Schema-evolvable JSON is well understood; full markdown migration
 *     belongs in a dedicated session with a subagent owning storage.ts
 *   - Trimmed scope: deliver the visible value (readable, diffable,
 *     greppable) without the storage rewrite risk
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import { generateStableId } from '../types.js';

const MD_DIR = 'components-md';
const CONNECTIONS_JSONL = 'connections.jsonl';

function escapeYaml(value: string): string {
  // Quote any value that could be misparsed; keep simple inline strings unquoted only when safe.
  if (/^[\w./:_-]+$/.test(value) && value.length < 80) return value;
  return JSON.stringify(value);
}

function frontmatterValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return escapeYaml(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // For objects/arrays, embed as inline JSON — readable and round-trippable.
  return JSON.stringify(v);
}

function buildFrontmatter(
  c: ArchitectureComponent,
  metricLookup?: Map<string, { pagerank_score: number; community_id: number }>
): string {
  const stable = c.stable_id ?? generateStableId(c.type, c.name);
  const m = metricLookup?.get(c.component_id);
  const fields: Record<string, unknown> = {
    stable_id: stable,
    component_id: c.component_id,
    name: c.name,
    type: c.type,
    layer: c.role?.layer,
    critical: c.role?.critical,
    status: c.status,
    confidence: c.source?.confidence,
    detection_method: c.source?.detection_method,
    config_files: c.source?.config_files ?? [],
    tags: c.tags ?? [],
    pagerank_score: m?.pagerank_score,
    community_id: m?.community_id,
  };
  if (c.version) fields.version = c.version;
  if (c.runtime?.engine) fields.runtime_engine = c.runtime.engine;
  if (c.runtime?.resource_type) fields.runtime_type = c.runtime.resource_type;
  if (c.runtime?.connection_env_var) fields.runtime_env = c.runtime.connection_env_var;
  if (c.documentation_url) fields.documentation_url = c.documentation_url;

  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    lines.push(`${k}: ${frontmatterValue(v)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildBody(c: ArchitectureComponent, neighbors: { incoming: string[]; outgoing: string[] }): string {
  const lines: string[] = [];
  lines.push(`# ${c.name}`);
  lines.push('');
  if (c.role?.purpose) {
    lines.push(c.role.purpose);
    lines.push('');
  }

  if (c.source?.config_files?.length) {
    lines.push('## Sources');
    for (const f of c.source.config_files) lines.push(`- \`${f}\``);
    lines.push('');
  }

  if (neighbors.outgoing.length || neighbors.incoming.length) {
    lines.push('## Connections');
    if (neighbors.outgoing.length) {
      lines.push('### Outgoing');
      for (const id of neighbors.outgoing) lines.push(`- [[${id}]]`);
    }
    if (neighbors.incoming.length) {
      lines.push('### Incoming');
      for (const id of neighbors.incoming) lines.push(`- [[${id}]]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write markdown views for every component into `<storage>/components-md/<type>/<slug>.md`.
 * Wipes the directory first so renames/removals are reflected. Idempotent.
 *
 * Returns the absolute paths written.
 */
export async function writeComponentMarkdownViews(
  storeDir: string,
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): Promise<string[]> {
  const mdRoot = path.join(storeDir, MD_DIR);
  if (fs.existsSync(mdRoot)) {
    await fs.promises.rm(mdRoot, { recursive: true, force: true });
  }
  await fs.promises.mkdir(mdRoot, { recursive: true });

  // Build neighbor lookup once: stable_id (preferred) or component_id
  const idOf = (c: ArchitectureComponent): string =>
    c.stable_id ?? generateStableId(c.type, c.name);
  const componentById = new Map<string, ArchitectureComponent>();
  for (const c of components) componentById.set(c.component_id, c);

  const neighbors = new Map<string, { incoming: string[]; outgoing: string[] }>();
  for (const c of components) neighbors.set(c.component_id, { incoming: [], outgoing: [] });
  for (const conn of connections) {
    const fromComp = componentById.get(conn.from?.component_id);
    const toComp = componentById.get(conn.to?.component_id);
    if (!fromComp || !toComp) continue;
    neighbors.get(fromComp.component_id)?.outgoing.push(idOf(toComp));
    neighbors.get(toComp.component_id)?.incoming.push(idOf(fromComp));
  }

  // Load metrics.json once if present so PageRank/community land in frontmatter.
  let metricLookup: Map<string, { pagerank_score: number; community_id: number }> | undefined;
  const metricsPath = path.join(storeDir, 'metrics.json');
  if (fs.existsSync(metricsPath)) {
    try {
      const raw = await fs.promises.readFile(metricsPath, 'utf-8');
      const report = JSON.parse(raw) as {
        suppressed: boolean;
        metrics: Array<{ component_id: string; pagerank_score: number; community_id: number }>;
      };
      if (!report.suppressed) {
        metricLookup = new Map(
          report.metrics.map((m) => [m.component_id, { pagerank_score: m.pagerank_score, community_id: m.community_id }])
        );
      }
    } catch {
      // metrics.json malformed → skip (frontmatter just won't include scores).
    }
  }

  const written: string[] = [];
  // File names = stable_id so [[STABLE_*]] wikilinks in body resolve in
  // Obsidian / Foam without an alias rewrite (Codex audit fix). stable_id
  // is already collision-safe (FNV suffix on lossy input) so no extra
  // disambiguation is needed.
  for (const c of components) {
    const typeDir = path.join(mdRoot, c.type);
    await fs.promises.mkdir(typeDir, { recursive: true });
    const stableId = c.stable_id ?? generateStableId(c.type, c.name);
    const filePath = path.join(typeDir, `${stableId}.md`);
    const content =
      buildFrontmatter(c, metricLookup) +
      '\n\n' +
      buildBody(c, neighbors.get(c.component_id) ?? { incoming: [], outgoing: [] }) +
      '\n';
    await fs.promises.writeFile(filePath, content, 'utf-8');
    written.push(filePath);
  }
  return written;
}

/**
 * Write `<storage>/connections.jsonl` — one JSON record per line.
 * Schema-evolvable, streamable, diffable. Replaces the per-connection JSON
 * files for downstream consumers willing to upgrade; the originals stay
 * untouched for backward compatibility.
 */
export async function writeConnectionsJsonl(
  storeDir: string,
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): Promise<string> {
  const filePath = path.join(storeDir, CONNECTIONS_JSONL);
  const idOf = (c: ArchitectureComponent | undefined): string | undefined =>
    c ? (c.stable_id ?? generateStableId(c.type, c.name)) : undefined;
  const byId = new Map(components.map((c) => [c.component_id, c]));

  const lines: string[] = [];
  for (const conn of connections) {
    const fromStable = idOf(byId.get(conn.from?.component_id));
    const toStable = idOf(byId.get(conn.to?.component_id));
    lines.push(
      JSON.stringify({
        connection_id: conn.connection_id,
        from_id: conn.from?.component_id,
        to_id: conn.to?.component_id,
        from_stable: fromStable,
        to_stable: toStable,
        type: conn.connection_type,
        file: conn.code_reference?.file,
        line: conn.code_reference?.line_start,
        symbol: conn.code_reference?.symbol,
        confidence: conn.confidence,
        classification: conn.semantic?.classification,
      })
    );
  }
  await fs.promises.writeFile(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
  return filePath;
}
