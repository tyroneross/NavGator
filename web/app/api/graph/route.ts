/**
 * API Route: /api/graph
 *
 * Returns architecture graph data (nodes + edges) from graph.json
 * Enriches nodes with component details when available.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { loadArchitectureRecords, type ArchitectureRecord } from "@/lib/server/architecture-storage";

const graphCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60000;

interface GraphNode {
  id: string;
  name: string;
  type: string;
  layer: string;
  version?: string;
  purpose?: string;
  configFiles?: string[];
  tags?: string[];
  connectsTo?: string[];
  connectedFrom?: string[];
  hostedBy?: string;
  hosts?: string[];
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
}

// Derive inter-node flow edges from full connection records.
// The raw graph.json edges use FILE:... sources that don't match node IDs.
function deriveFlowEdges(
  connections: ArchitectureRecord[],
  nodes: GraphNode[],
): GraphEdge[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Path-to-layer heuristic
  function fileToLayer(filePath: string): string {
    const p = filePath.toLowerCase();
    if (p.startsWith("app/") || p.startsWith("pages/") || p.startsWith("src/app/")) return "frontend";
    if (p.includes("worker") || p.includes("queue") || p.includes("job")) return "queue";
    return "backend";
  }

  // Pick representative nodes per layer — only use framework, service, database, queue, llm, infra types
  // Never use generic npm packages as representatives
  const meaningfulTypes = new Set(["framework", "service", "database", "queue", "llm", "infra"]);
  const layerReps = new Map<string, string>();
  for (const node of nodes) {
    if (!meaningfulTypes.has(node.type)) continue;
    const layer = node.layer || "backend";
    if (!layerReps.has(layer)) {
      layerReps.set(layer, node.id);
    }
    // Prefer framework nodes as the layer representative
    if (node.type === "framework") {
      layerReps.set(layer, node.id);
    }
  }

  const edgeSet = new Map<string, { source: string; target: string; type: string; count: number }>();
  for (const connection of connections) {
    const from = connection.from as ArchitectureRecord | undefined;
    const to = connection.to as ArchitectureRecord | undefined;
    const targetId = typeof to?.component_id === "string" ? to.component_id : "";
    if (!targetId || !nodeById.has(targetId)) continue;

    const fromId = typeof from?.component_id === "string" ? from.component_id : "";
    if (!fromId.startsWith("FILE:")) continue;
    const layer = fileToLayer(fromId.slice(5));
    const sourceId = layerReps.get(layer) || null;
    if (sourceId && sourceId !== targetId && nodeById.has(sourceId)) {
      const connType = typeof connection.connection_type === "string"
        ? connection.connection_type
        : "service-call";
      const key = `${sourceId}->${targetId}`;
      const existing = edgeSet.get(key);
      if (existing) existing.count++;
      else edgeSet.set(key, { source: sourceId, target: targetId, type: connType, count: 1 });
    }
  }

  const edges: GraphEdge[] = [];
  edgeSet.forEach((edge) => {
    edges.push({
      id: `flow-${edges.length}`,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.count > 1 ? `${edge.count} calls` : undefined,
    });
  });
  return edges;
}

// Infer hosting relationships between infra and services
function inferHosting(nodes: GraphNode[], edges: GraphEdge[]): void {
  const infraNodes = nodes.filter((n) => n.layer === "infra");
  const serviceTypes = new Set(["queue", "database", "backend"]);

  // Build a map of edges for lookup
  const edgeMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, new Set());
    edgeMap.get(edge.source)!.add(edge.target);
  }

  // Known hosting patterns — only match core services, not npm client libraries
  // Use exact name matches or type-restricted patterns to avoid over-matching
  const hostingPatterns: Record<string, { names: string[]; types: Set<string> }> = {
    railway: { names: ["bullmq", "redis", "pg", "postgres"], types: new Set(["database", "queue", "service"]) },
    vercel: { names: ["next", "next.js", "nextjs"], types: new Set(["framework", "service"]) },
    heroku: { names: ["redis", "pg", "postgres"], types: new Set(["database", "queue", "service"]) },
    render: { names: ["redis", "pg", "postgres"], types: new Set(["database", "queue", "service"]) },
  };

  for (const infra of infraNodes) {
    const infraKey = infra.name.toLowerCase();
    const pattern = hostingPatterns[infraKey];
    if (!pattern) continue;

    for (const node of nodes) {
      if (node.id === infra.id) continue;
      if (!serviceTypes.has(node.layer) && node.layer !== "frontend") continue;
      // Only match if node type is in the allowed set
      if (!pattern.types.has(node.type)) continue;

      const nameKey = node.name.toLowerCase();
      const matches = pattern.names.some((p) => nameKey === p || nameKey.includes(p));

      if (matches) {
        node.hostedBy = infra.id;
        if (!infra.hosts) infra.hosts = [];
        infra.hosts.push(node.id);
      }
    }
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");
  const cacheKey = projectPath || "__default__";
  const cached = graphCache.get(cacheKey);

  if (!refresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ success: true, data: cached.data, source: "cache" });
  }

  try {
    const basePath = projectPath
      || process.env.NAVGATOR_PROJECT_PATH
      || process.cwd().replace(/\/web$/, "");
    const graphPath = path.join(basePath, ".navgator", "architecture", "graph.json");

    const content = await fs.readFile(graphPath, "utf-8");
    const graph = JSON.parse(content);
    const records = await loadArchitectureRecords(basePath);
    const componentsById = new Map(
      records.components.map((component) => [String(component.component_id || component.id || ""), component]),
    );

    const enrichedNodes: GraphNode[] = (graph.nodes as GraphNode[]).map((node) => {
      const component = componentsById.get(node.id);
      if (!component) return node;
      const role = component.role as ArchitectureRecord | undefined;
      const source = component.source as ArchitectureRecord | undefined;
      return {
        ...node,
        version: typeof component.version === "string" ? component.version : undefined,
        purpose: typeof role?.purpose === "string" ? role.purpose : undefined,
        configFiles: Array.isArray(source?.config_files) ? source.config_files.map(String) : undefined,
        tags: Array.isArray(component.tags) ? component.tags.map(String) : undefined,
        connectsTo: Array.isArray(component.connects_to) ? component.connects_to.map(String) : undefined,
        connectedFrom: Array.isArray(component.connected_from) ? component.connected_from.map(String) : undefined,
      };
    });

    // Infer hosting relationships
    inferHosting(enrichedNodes, graph.edges);

    const flowEdges = deriveFlowEdges(records.connections, enrichedNodes);

    const data = {
      nodes: enrichedNodes,
      edges: [...graph.edges, ...flowEdges],
      metadata: graph.metadata,
    };

    graphCache.set(cacheKey, { data, timestamp: Date.now() });

    return NextResponse.json({ success: true, data, source: "scan" });
  } catch {
    return NextResponse.json(
      { success: false, error: "No graph data found. Run a scan first.", data: null },
      { status: 200 }
    );
  }
}
