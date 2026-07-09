import * as fs from "fs/promises";
import * as path from "path";

export type ArchitectureRecord = Record<string, unknown>;

export interface ArchitectureRecords {
  components: ArchitectureRecord[];
  connections: ArchitectureRecord[];
  generatedAt?: number;
}

async function readJson(filePath: string): Promise<ArchitectureRecord | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function readJsonDir(dir: string): Promise<ArchitectureRecord[]> {
  try {
    const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".json"));
    const records = await Promise.all(files.map((file) => readJson(path.join(dir, file))));
    return records.filter((record): record is ArchitectureRecord => record !== null);
  } catch {
    return [];
  }
}

async function readJsonLines(filePath: string): Promise<ArchitectureRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const records: ArchitectureRecord[] = [];
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // Skip one corrupt line without discarding the rest of the snapshot.
      }
    }
    return records;
  } catch {
    return [];
  }
}

function inflateGraphNode(node: ArchitectureRecord): ArchitectureRecord {
  return {
    component_id: node.id,
    stable_id: node.stable_id,
    name: node.name,
    type: node.type,
    role: { layer: node.layer },
    status: "active",
  };
}

function inflateConnection(record: ArchitectureRecord): ArchitectureRecord {
  if (record.from && record.to) return record;
  return {
    connection_id: record.connection_id || record.id,
    from: { component_id: record.from_id || record.source },
    to: { component_id: record.to_id || record.target },
    connection_type: record.connection_type || record.type,
    description: record.description || record.label,
    confidence: record.confidence,
    code_reference: {
      file: record.file,
      line_start: record.line,
      symbol: record.symbol,
    },
    semantic: { classification: record.classification },
  };
}

/**
 * Read the default consolidated architecture snapshot and enrich it with
 * optional per-entity records when those files are enabled.
 */
export async function loadArchitectureRecords(root: string): Promise<ArchitectureRecords> {
  const architectureDir = path.join(root, ".navgator", "architecture");
  const graph = await readJson(path.join(architectureDir, "graph.json"));
  const graphNodes = Array.isArray(graph?.nodes)
    ? (graph.nodes as ArchitectureRecord[]).map(inflateGraphNode)
    : [];
  const graphEdges = Array.isArray(graph?.edges)
    ? (graph.edges as ArchitectureRecord[]).map(inflateConnection)
    : [];

  const entityComponents = await readJsonDir(path.join(architectureDir, "components"));
  const fullComponents = await readJsonLines(path.join(architectureDir, "components.full.jsonl"));
  const components = entityComponents.length > 0
    ? entityComponents
    : fullComponents.length > 0
      ? fullComponents
      : graphNodes;

  const entityConnections = await readJsonDir(path.join(architectureDir, "connections"));
  const fullConnections = await readJsonLines(path.join(architectureDir, "connections.full.jsonl"));
  const compactConnections = await readJsonLines(path.join(architectureDir, "connections.jsonl"));
  const connections = entityConnections.length > 0
    ? entityConnections
    : fullConnections.length > 0
      ? fullConnections
      : compactConnections.length > 0
        ? compactConnections.map(inflateConnection)
        : graphEdges.map(inflateConnection);

  const metadata = graph?.metadata as ArchitectureRecord | undefined;
  return {
    components,
    connections,
    generatedAt: typeof metadata?.generated_at === "number" ? metadata.generated_at : undefined,
  };
}
