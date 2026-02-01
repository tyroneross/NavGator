/**
 * API Route: /api/graph
 *
 * Returns architecture graph data (nodes + edges) from graph.json
 * Enriches nodes with component details when available.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

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

// Derive inter-node flow edges from connection files
// The raw graph.json edges use FILE:... sources that don't match node IDs.
// This reads CONN_service-call_*.json files and maps FILE: sources to
// their closest parent component node using path heuristics.
async function deriveFlowEdges(
  connectionsDir: string,
  nodes: GraphNode[],
): Promise<GraphEdge[]> {
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

  try {
    const files = await fs.readdir(connectionsDir);
    const connFiles = files.filter((f) => f.startsWith("CONN_service-call") && f.endsWith(".json"));

    // Aggregate: deduplicate by (sourceNodeId, targetNodeId)
    const edgeSet = new Map<string, { source: string; target: string; type: string; count: number }>();

    for (const file of connFiles) {
      try {
        const content = await fs.readFile(path.join(connectionsDir, file), "utf-8");
        const conn = JSON.parse(content);
        const targetId = conn.to?.component_id;
        if (!targetId || !nodeById.has(targetId)) continue;

        // Map FILE: source to a layer representative node
        const srcFile = (conn.from?.component_id || "").replace("FILE:", "");
        const layer = fileToLayer(srcFile);
        const sourceId = layerReps.get(layer) || null;

        if (sourceId && sourceId !== targetId && nodeById.has(sourceId)) {
          const key = `${sourceId}->${targetId}`;
          const existing = edgeSet.get(key);
          if (existing) {
            existing.count++;
          } else {
            edgeSet.set(key, { source: sourceId, target: targetId, type: "service-call", count: 1 });
          }
        }
      } catch {
        // Skip invalid connection files
      }
    }

    // Convert to GraphEdge array
    const edges: GraphEdge[] = [];
    edgeSet.forEach((e, _key) => {
      edges.push({
        id: `flow-${edges.length}`,
        source: e.source,
        target: e.target,
        type: e.type,
        label: e.count > 1 ? `${e.count} calls` : undefined,
      });
    });
    return edges;
  } catch {
    return [];
  }
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
      || process.cwd();
    const graphPath = path.join(basePath, ".claude", "architecture", "graph.json");
    const componentsDir = path.join(basePath, ".claude", "architecture", "components");

    const content = await fs.readFile(graphPath, "utf-8");
    const graph = JSON.parse(content);

    // Enrich nodes with component details
    const enrichedNodes: GraphNode[] = await Promise.all(
      (graph.nodes as GraphNode[]).map(async (node) => {
        try {
          const files = await fs.readdir(componentsDir);
          const compFile = files.find((f) => f.startsWith(node.id) && f.endsWith(".json"));
          if (compFile) {
            const compContent = await fs.readFile(path.join(componentsDir, compFile), "utf-8");
            const comp = JSON.parse(compContent);
            return {
              ...node,
              version: comp.version || undefined,
              purpose: comp.role?.purpose || undefined,
              configFiles: comp.source?.config_files || undefined,
              tags: comp.tags || undefined,
              connectsTo: comp.connects_to || undefined,
              connectedFrom: comp.connected_from || undefined,
            };
          }
        } catch {
          // Component file not found, use base node
        }
        return node;
      })
    );

    // Infer hosting relationships
    inferHosting(enrichedNodes, graph.edges);

    // Derive inter-node flow edges from connection files
    const connectionsDir = path.join(basePath, ".claude", "architecture", "connections");
    const flowEdges = await deriveFlowEdges(connectionsDir, enrichedNodes);

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
