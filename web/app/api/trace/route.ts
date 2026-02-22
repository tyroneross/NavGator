/**
 * API Route: /api/trace
 *
 * Traces dataflow from a component through the architecture graph.
 * Mirrors src/trace.ts logic but works on raw JSON files.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { TraceApiResponse, TraceResult, TracePath, TraceStep } from "@/lib/types";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const component = searchParams.get("component");
  const direction = (searchParams.get("direction") || "both") as "forward" | "backward" | "both";
  const maxDepth = Math.min(parseInt(searchParams.get("maxDepth") || "5", 10), 10);
  const filterClassification = searchParams.get("filter") || undefined;
  const projectPath = searchParams.get("path");

  if (!component) {
    return NextResponse.json<TraceApiResponse>({
      success: false,
      error: "Missing required parameter: component",
      source: "scan",
    });
  }

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
      return NextResponse.json<TraceApiResponse>({
        success: true,
        data: {
          query: component,
          paths: [],
          components_touched: [],
          layers_crossed: [],
        },
        source: "scan",
      });
    }

    const result = traceInline(component, components, connections, {
      maxDepth,
      direction,
      filterClassification,
    });

    return NextResponse.json<TraceApiResponse>({
      success: true,
      data: result,
      source: "scan",
    });
  } catch (error) {
    console.error("Error tracing dataflow:", error);
    return NextResponse.json<TraceApiResponse>({
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

// Helpers to extract fields from raw JSON
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
function getConnType(c: Record<string, unknown>): string {
  return String(c.type || "");
}
function getConnId(c: Record<string, unknown>): string {
  return String(c.connection_id || "");
}

function toCompact(c: Record<string, unknown>) {
  return { id: getId(c), n: getName(c), t: getType(c), l: getLayer(c) };
}

function toConnCompact(c: Record<string, unknown>) {
  return { id: getConnId(c), f: getFromId(c), t: getToId(c), tp: getConnType(c) };
}

interface TraceOpts {
  maxDepth: number;
  direction: "forward" | "backward" | "both";
  filterClassification?: string;
}

function traceInline(
  query: string,
  components: Record<string, unknown>[],
  connections: Record<string, unknown>[],
  opts: TraceOpts
): TraceResult {
  // Resolve component by name (case-insensitive partial match)
  const queryLower = query.toLowerCase();
  const startComp = components.find(
    (c) => getName(c).toLowerCase() === queryLower
  ) || components.find(
    (c) => getName(c).toLowerCase().includes(queryLower)
  );

  if (!startComp) {
    return {
      query,
      paths: [],
      components_touched: [],
      layers_crossed: [],
    };
  }

  const startId = getId(startComp);

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

  const componentMap = new Map(allComponents.map((c) => [getId(c), c]));

  // Build adjacency
  const outgoing = new Map<string, Record<string, unknown>[]>();
  const incoming = new Map<string, Record<string, unknown>[]>();
  for (const conn of connections) {
    const fromId = getFromId(conn);
    const toId = getToId(conn);
    if (!outgoing.has(fromId)) outgoing.set(fromId, []);
    outgoing.get(fromId)!.push(conn);
    if (!incoming.has(toId)) incoming.set(toId, []);
    incoming.get(toId)!.push(conn);
  }

  const paths: TracePath[] = [];
  const touchedIds = new Set<string>([startId]);
  const layerSet = new Set<string>([getLayer(startComp)]);

  type QueueItem = {
    componentId: string;
    path: TraceStep[];
    depth: number;
    visited: Set<string>;
  };

  const queue: QueueItem[] = [
    {
      componentId: startId,
      path: [{ component: toCompact(startComp) }],
      depth: 0,
      visited: new Set([startId]),
    },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= opts.maxDepth) {
      if (current.path.length > 1) {
        paths.push({ steps: current.path });
      }
      continue;
    }

    const nextConns: Array<{ conn: Record<string, unknown>; nextId: string }> = [];

    if (opts.direction === "forward" || opts.direction === "both") {
      for (const conn of outgoing.get(current.componentId) || []) {
        const toId = getToId(conn);
        if (!current.visited.has(toId)) {
          nextConns.push({ conn, nextId: toId });
        }
      }
    }

    if (opts.direction === "backward" || opts.direction === "both") {
      for (const conn of incoming.get(current.componentId) || []) {
        const fromId = getFromId(conn);
        if (!current.visited.has(fromId)) {
          nextConns.push({ conn, nextId: fromId });
        }
      }
    }

    // Classification filter
    const filtered = opts.filterClassification
      ? nextConns.filter(({ conn }) => {
          const semantic = conn.semantic as Record<string, unknown> | undefined;
          return semantic?.classification === opts.filterClassification;
        })
      : nextConns;

    if (filtered.length === 0 && current.path.length > 1) {
      paths.push({ steps: current.path });
      continue;
    }

    for (const { conn, nextId } of filtered) {
      const nextComp = componentMap.get(nextId);
      if (!nextComp) continue;

      touchedIds.add(nextId);
      layerSet.add(getLayer(nextComp));

      const codeRef = conn.code_reference as Record<string, unknown> | undefined;
      const step: TraceStep = {
        component: toCompact(nextComp),
        connection: toConnCompact(conn),
        file: codeRef?.file as string | undefined,
        line: codeRef?.line_start as number | undefined,
      };

      const newVisited = new Set(current.visited);
      newVisited.add(nextId);

      queue.push({
        componentId: nextId,
        path: [...current.path, step],
        depth: current.depth + 1,
        visited: newVisited,
      });
    }
  }

  // Deduplicate paths
  const seen = new Set<string>();
  const uniquePaths: TracePath[] = [];
  for (const p of paths) {
    const key = p.steps.map((s) => s.component.id).join("→");
    if (!seen.has(key)) {
      seen.add(key);
      uniquePaths.push(p);
    }
  }

  // Assign classifications
  for (const tracePath of uniquePaths) {
    const classifications = tracePath.steps
      .filter((s) => s.connection)
      .map((s) => {
        const conn = connections.find(
          (c) => getConnId(c) === s.connection?.id
        );
        const semantic = conn?.semantic as Record<string, unknown> | undefined;
        return semantic?.classification as string | undefined;
      })
      .filter(Boolean) as string[];

    if (classifications.length > 0) {
      const counts = new Map<string, number>();
      for (const c of classifications) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
      tracePath.classification = [...counts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0][0];
    }
  }

  return {
    query: getName(startComp),
    paths: uniquePaths,
    components_touched: [...touchedIds],
    layers_crossed: [...layerSet],
  };
}
