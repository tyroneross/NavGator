/**
 * API Route: /api/components
 *
 * Returns architecture component data from NavGator scans.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { Component, ComponentsApiResponse, ComponentsSummary } from "@/lib/types";

// Cache for component data (keyed by project path)
const componentsCache = new Map<string, { data: ComponentsApiResponse["data"]; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

/**
 * GET /api/components
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const demoMode = searchParams.get("demo") === "true";
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

  // Demo mode
  if (demoMode) {
    return NextResponse.json<ComponentsApiResponse>({
      success: true,
      data: generateDemoComponents(),
      source: "mock",
    });
  }

  const cacheKey = projectPath || "__default__";
  const cached = componentsCache.get(cacheKey);

  // Check cache
  if (!refresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json<ComponentsApiResponse>({
      success: true,
      data: cached.data,
      source: "cache",
    });
  }

  try {
    const data = await loadComponentData(projectPath);

    if (data) {
      componentsCache.set(cacheKey, { data, timestamp: Date.now() });

      return NextResponse.json<ComponentsApiResponse>({
        success: true,
        data,
        source: "scan",
      });
    }

    // No scan data - check if user explicitly wants demo
    if (demoMode) {
      return NextResponse.json<ComponentsApiResponse>({
        success: true,
        data: generateDemoComponents(),
        source: "mock",
      });
    }

    // Return empty state - prompt user to run setup
    return NextResponse.json<ComponentsApiResponse>({
      success: true,
      data: {
        components: [],
        summary: {
          totalComponents: 0,
          byType: {},
          byLayer: {},
          outdatedCount: 0,
        },
      },
      source: "scan",
      error: "No scan data found. Run `navgator setup` to scan your project.",
    });
  } catch (error) {
    console.error("Error loading component data:", error);
    return NextResponse.json<ComponentsApiResponse>({
      success: false,
      data: {
        components: [],
        summary: {
          totalComponents: 0,
          byType: {},
          byLayer: {},
          outdatedCount: 0,
        },
      },
      source: "scan",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadComponentData(
  projectPath?: string | null
): Promise<ComponentsApiResponse["data"] | null> {
  // Priority: query param > env var > NavGator directory
  const root = projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");

  // Try to load from NavGator storage
  const componentsDir = path.join(root, ".claude", "architecture", "components");

  try {
    const files = await fs.readdir(componentsDir);
    const componentFiles = files.filter((f) => f.endsWith(".json"));

    if (componentFiles.length === 0) return null;

    const components: Component[] = [];

    for (const file of componentFiles) {
      try {
        const content = await fs.readFile(path.join(componentsDir, file), "utf-8");
        const raw = JSON.parse(content);
        components.push(transformComponent(raw));
      } catch {
        // Skip invalid files
      }
    }

    if (components.length === 0) return null;

    return {
      components,
      summary: buildSummary(components),
    };
  } catch {
    return null;
  }
}

function transformComponent(raw: Record<string, unknown>): Component {
  const role = raw.role as Record<string, unknown> | undefined;

  return {
    id: String(raw.component_id || raw.id || ""),
    name: String(raw.name || ""),
    type: mapType(String(raw.type || "")),
    layer: mapLayer(String(role?.layer || "")),
    version: raw.version ? String(raw.version) : undefined,
    purpose: role?.purpose ? String(role.purpose) : undefined,
    connections: Array.isArray(raw.connects_to) ? raw.connects_to.length : 0,
    status: mapStatus(String(raw.status || "active")),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    file: (raw.source as Record<string, unknown>)?.config_files?.[0] as string | undefined,
  };
}

function mapType(type: string): Component["type"] {
  const typeMap: Record<string, Component["type"]> = {
    npm: "npm",
    pip: "pip",
    cargo: "cargo",
    go: "go",
    gem: "gem",
    composer: "composer",
    service: "service",
    database: "database",
    queue: "queue",
    infra: "infra",
    framework: "framework",
    prompt: "prompt",
    llm: "llm",
  };
  return typeMap[type] || "npm";
}

function mapLayer(layer: string): Component["layer"] {
  const layerMap: Record<string, Component["layer"]> = {
    frontend: "frontend",
    backend: "backend",
    data: "data",
    shared: "shared",
    external: "external",
    hosting: "hosting",
  };
  return layerMap[layer] || "backend";
}

function mapStatus(status: string): Component["status"] {
  const statusMap: Record<string, Component["status"]> = {
    active: "active",
    outdated: "outdated",
    deprecated: "deprecated",
    removed: "removed",
  };
  return statusMap[status] || "active";
}

function buildSummary(components: Component[]): ComponentsSummary {
  const byType: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  let outdatedCount = 0;

  for (const c of components) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byLayer[c.layer] = (byLayer[c.layer] || 0) + 1;
    if (c.status === "outdated") outdatedCount++;
  }

  return {
    totalComponents: components.length,
    byType,
    byLayer,
    outdatedCount,
    lastScanned: new Date().toISOString(),
  };
}

// =============================================================================
// DEMO DATA
// =============================================================================

function generateDemoComponents(): ComponentsApiResponse["data"] {
  const components: Component[] = [
    { id: "comp-1", name: "react", type: "npm", layer: "frontend", version: "18.2.0", connections: 12, status: "active", tags: ["ui", "core"] },
    { id: "comp-2", name: "next", type: "npm", layer: "frontend", version: "14.0.0", connections: 8, status: "active", tags: ["framework", "ssr"] },
    { id: "comp-3", name: "stripe", type: "npm", layer: "backend", version: "14.5.0", connections: 3, status: "active", tags: ["payments"] },
    { id: "comp-4", name: "bullmq", type: "npm", layer: "backend", version: "4.12.0", connections: 5, status: "active", tags: ["queue", "jobs"] },
    { id: "comp-5", name: "prisma", type: "npm", layer: "data", version: "5.6.0", connections: 6, status: "active", tags: ["orm", "database"] },
    { id: "comp-6", name: "zod", type: "npm", layer: "shared", version: "3.22.0", connections: 7, status: "active", tags: ["validation"] },
    { id: "comp-7", name: "tailwindcss", type: "npm", layer: "frontend", version: "3.3.5", connections: 4, status: "active", tags: ["css", "styling"] },
    { id: "comp-8", name: "typescript", type: "npm", layer: "shared", version: "5.2.2", connections: 15, status: "active", tags: ["language", "types"] },
    { id: "comp-9", name: "Stripe", type: "service", layer: "external", purpose: "Payments", connections: 3, status: "active", tags: ["payments", "api"] },
    { id: "comp-10", name: "OpenAI", type: "service", layer: "external", purpose: "AI/ML", connections: 2, status: "active", tags: ["ai", "llm"] },
    { id: "comp-11", name: "Anthropic", type: "service", layer: "external", purpose: "AI/ML", connections: 2, status: "active", tags: ["ai", "llm"] },
    { id: "comp-12", name: "SendGrid", type: "service", layer: "external", purpose: "Email", connections: 1, status: "active", tags: ["email"] },
    { id: "comp-13", name: "PostgreSQL", type: "database", layer: "data", purpose: "Primary DB", connections: 8, status: "active", tags: ["sql", "relational"] },
    { id: "comp-14", name: "Redis", type: "database", layer: "data", purpose: "Cache", connections: 4, status: "active", tags: ["cache", "memory"] },
    { id: "comp-15", name: "Vercel", type: "infra", layer: "hosting", purpose: "Deployment", connections: 2, status: "active", tags: ["hosting", "deploy"] },
  ];

  return {
    components,
    summary: buildSummary(components),
  };
}
