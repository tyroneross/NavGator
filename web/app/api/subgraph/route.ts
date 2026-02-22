/**
 * API Route: /api/subgraph
 *
 * Extracts a focused subgraph from the architecture.
 * Mirrors src/subgraph.ts logic but works on raw JSON files.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { SubgraphApiResponse, SubgraphResult } from "@/lib/types";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const focus = searchParams.get("focus");
  const depth = Math.min(parseInt(searchParams.get("depth") || "2", 10), 5);
  const layers = searchParams.get("layers");
  const classification = searchParams.get("classification") || undefined;
  const maxNodes = Math.min(
    parseInt(searchParams.get("maxNodes") || "50", 10),
    200
  );
  const projectPath = searchParams.get("path");

  try {
    const root =
      projectPath ||
      process.env.NAVGATOR_PROJECT_PATH ||
      process.cwd().replace(/\/web$/, "");

    const componentsDir = path.join(root, ".claude", "architecture", "components");
    const connectionsDir = path.join(root, ".claude", "architecture", "connections");

    const components = await loadJsonDir(componentsDir);
    const connections = await loadJsonDir(connectionsDir);

    if (components.length === 0) {
      return NextResponse.json<SubgraphApiResponse>({
        success: true,
        data: {
          components: [],
          connections: [],
          stats: { nodes: 0, edges: 0 },
        },
        source: "scan",
      });
    }

    const focusList = focus
      ? focus.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const layerList = layers
      ? layers.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const result = extractSubgraphInline(components, connections, {
      focus: focusList,
      layers: layerList,
      classification,
      depth,
      maxNodes,
    });

    return NextResponse.json<SubgraphApiResponse>({
      success: true,
      data: result,
      source: "scan",
    });
  } catch (error) {
    console.error("Error extracting subgraph:", error);
    return NextResponse.json<SubgraphApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      source: "scan",
    });
  }
}

async function loadJsonDir(dir: string): Promise<Record<string, unknown>[]> {
  try {
    const files = await fs.readdir(dir);
    const results: Record<string, unknown>[] = [];
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const content = await fs.readFile(path.join(dir, file), "utf-8");
        results.push(JSON.parse(content));
      } catch {
        // Skip invalid files
      }
    }
    return results;
  } catch {
    return [];
  }
}

function getId(c: Record<string, unknown>): string {
  return String(c.component_id || "");
}
function getName(c: Record<string, unknown>): string {
  return String(c.name || "?");
}
function getType(c: Record<string, unknown>): string {
  return String(c.type || "");
}
function getLayer(c: Record<string, unknown>): string {
  return String((c.role as Record<string, unknown> | undefined)?.layer || "");
}
function getFromId(c: Record<string, unknown>): string {
  return String((c.from as Record<string, unknown> | undefined)?.component_id || "");
}
function getToId(c: Record<string, unknown>): string {
  return String((c.to as Record<string, unknown> | undefined)?.component_id || "");
}
function getConnId(c: Record<string, unknown>): string {
  return String(c.connection_id || "");
}
function getConnType(c: Record<string, unknown>): string {
  return String(c.type || "");
}

interface SubgraphOpts {
  focus: string[];
  layers: string[];
  classification?: string;
  depth: number;
  maxNodes: number;
}

function extractSubgraphInline(
  components: Record<string, unknown>[],
  connections: Record<string, unknown>[],
  opts: SubgraphOpts
): SubgraphResult {
  // Synthesize virtual components for FILE: references in connections
  const allComponents = [...components];
  const knownIds = new Set(components.map(getId));
  for (const conn of connections) {
    for (const refId of [getFromId(conn), getToId(conn)]) {
      if (refId && !knownIds.has(refId) && refId.startsWith("FILE:")) {
        const filePath = refId.slice(5);
        const fileName = filePath.split("/").pop() || filePath;
        allComponents.push({
          component_id: refId,
          name: fileName,
          type: "file",
          role: { layer: "application" },
        });
        knownIds.add(refId);
      }
    }
  }

  let filteredIds = new Set<string>();

  if (opts.focus.length > 0) {
    // Resolve focus names to component IDs
    const focusIds = new Set<string>();
    for (const query of opts.focus) {
      const queryLower = query.toLowerCase();
      const match =
        allComponents.find((c) => getName(c).toLowerCase() === queryLower) ||
        allComponents.find((c) => getName(c).toLowerCase().includes(queryLower));
      if (match) focusIds.add(getId(match));
    }

    if (focusIds.size === 0) {
      return {
        components: [],
        connections: [],
        stats: { nodes: 0, edges: 0 },
      };
    }

    // BFS from focus components
    const visited = new Set<string>(focusIds);
    let frontier = [...focusIds];

    for (let d = 0; d < opts.depth; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        for (const conn of connections) {
          if (getFromId(conn) === id && !visited.has(getToId(conn))) {
            visited.add(getToId(conn));
            nextFrontier.push(getToId(conn));
          }
          if (getToId(conn) === id && !visited.has(getFromId(conn))) {
            visited.add(getFromId(conn));
            nextFrontier.push(getFromId(conn));
          }
        }
      }
      frontier = nextFrontier;
    }

    filteredIds = visited;
  } else {
    filteredIds = new Set(allComponents.map(getId));
  }

  // Layer filter
  if (opts.layers.length > 0) {
    const layerSet = new Set(opts.layers);
    for (const id of [...filteredIds]) {
      const comp = allComponents.find((c) => getId(c) === id);
      if (comp && !layerSet.has(getLayer(comp))) {
        filteredIds.delete(id);
      }
    }
  }

  // Filter connections
  let filteredConns = connections.filter(
    (c) => filteredIds.has(getFromId(c)) && filteredIds.has(getToId(c))
  );

  // Classification filter
  if (opts.classification) {
    filteredConns = filteredConns.filter((c) => {
      const semantic = c.semantic as Record<string, unknown> | undefined;
      return semantic?.classification === opts.classification;
    });
  }

  // Apply maxNodes
  const filteredComps = allComponents.filter((c) => filteredIds.has(getId(c)));
  const limited = filteredComps.slice(0, opts.maxNodes);
  const limitedIds = new Set(limited.map(getId));
  const limitedConns = filteredConns.filter(
    (c) => limitedIds.has(getFromId(c)) && limitedIds.has(getToId(c))
  );

  // Build compact output
  const compactComponents = limited.map((c) => ({
    id: getId(c),
    n: getName(c),
    t: getType(c),
    l: getLayer(c),
  }));
  const compactConnections = limitedConns.map((c) => ({
    id: getConnId(c),
    f: getFromId(c),
    t: getToId(c),
    tp: getConnType(c),
  }));

  // Generate Mermaid
  const mermaidLines = ["graph TD", ""];
  for (const comp of compactComponents) {
    const safeId = comp.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const safeName = comp.n.replace(/"/g, "'").slice(0, 40);
    mermaidLines.push(`  ${safeId}["${safeName}"]`);
  }
  mermaidLines.push("");
  for (const conn of compactConnections) {
    const sourceId = conn.f.replace(/[^a-zA-Z0-9_]/g, "_");
    const targetId = conn.t.replace(/[^a-zA-Z0-9_]/g, "_");
    mermaidLines.push(`  ${sourceId} --> ${targetId}`);
  }

  return {
    components: compactComponents,
    connections: compactConnections,
    stats: { nodes: compactComponents.length, edges: compactConnections.length },
    mermaid: mermaidLines.join("\n"),
  };
}
