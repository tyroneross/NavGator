/**
 * API Route: /api/prompts
 *
 * Returns LLM call and prompt data from NavGator scans.
 * Supports both real scan data and demo mode.
 */

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import {
  transformScanResultWithDefaults,
  generateDemoData,
  type PromptScanResult,
} from "@/lib/transform";
import type { PromptsApiResponse } from "@/lib/types";

const execAsync = promisify(exec);

// Cache for scan results
let cachedData: PromptsApiResponse["data"] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * GET /api/prompts
 *
 * Query params:
 * - path: Project path to scan (optional, defaults to parent of web dir)
 * - demo: If "true", returns demo data
 * - refresh: If "true", bypasses cache
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const demoMode = searchParams.get("demo") === "true";
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

  // Demo mode - return synthetic data
  if (demoMode) {
    const demoData = generateDemoData();
    return NextResponse.json<PromptsApiResponse>({
      success: true,
      data: demoData,
      source: "mock",
    });
  }

  // Check cache
  if (!refresh && cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json<PromptsApiResponse>({
      success: true,
      data: cachedData,
      source: "cache",
    });
  }

  try {
    // Try to load scan results from NavGator storage
    const data = await loadScanData(projectPath);

    if (data) {
      cachedData = data;
      cacheTimestamp = Date.now();

      return NextResponse.json<PromptsApiResponse>({
        success: true,
        data,
        source: "scan",
      });
    }

    // No scan data available - check if user explicitly wants demo
    if (demoMode) {
      const demoData = generateDemoData();
      return NextResponse.json<PromptsApiResponse>({
        success: true,
        data: demoData,
        source: "mock",
      });
    }

    // Return empty state - prompt user to run setup
    return NextResponse.json<PromptsApiResponse>({
      success: true,
      data: {
        calls: [],
        prompts: [],
        summary: {
          totalCalls: 0,
          totalPrompts: 0,
          byProvider: {},
          byCategory: {},
          templatesCount: 0,
          withToolsCount: 0,
        },
      },
      source: "scan",
      error: "No scan data found. Run `navgator setup` to scan your project.",
    });
  } catch (error) {
    console.error("Error loading prompt data:", error);

    // Return empty state on error
    return NextResponse.json<PromptsApiResponse>({
      success: false,
      data: {
        calls: [],
        prompts: [],
        summary: {
          totalCalls: 0,
          totalPrompts: 0,
          byProvider: {},
          byCategory: {},
          templatesCount: 0,
          withToolsCount: 0,
        },
      },
      source: "scan",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * POST /api/prompts
 *
 * Trigger a new scan and return results
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectPath = body.path;

    // Run NavGator scan
    const scanResult = await runNavGatorScan(projectPath);

    if (scanResult) {
      const data = transformScanResultWithDefaults(scanResult);
      cachedData = data;
      cacheTimestamp = Date.now();

      return NextResponse.json<PromptsApiResponse>({
        success: true,
        data,
        source: "scan",
      });
    }

    return NextResponse.json<PromptsApiResponse>(
      {
        success: false,
        error: "Scan produced no results",
        source: "scan",
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("Error running scan:", error);
    return NextResponse.json<PromptsApiResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Scan failed",
        source: "scan",
      },
      { status: 500 }
    );
  }
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadScanData(
  projectPath?: string | null
): Promise<PromptsApiResponse["data"] | null> {
  // Priority: query param > env var > NavGator directory
  const root = projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");

  // Try to load from NavGator storage
  const storagePaths = [
    path.join(root, ".claude", "architecture", "prompts.json"),
    path.join(root, ".navgator", "prompts.json"),
  ];

  for (const storagePath of storagePaths) {
    try {
      const content = await fs.readFile(storagePath, "utf-8");
      const scanResult: PromptScanResult = JSON.parse(content);
      return transformScanResultWithDefaults(scanResult);
    } catch {
      // File doesn't exist or isn't valid JSON
      continue;
    }
  }

  // Try to load from component files
  const componentsDir = path.join(root, ".claude", "architecture", "components");
  try {
    const files = await fs.readdir(componentsDir);
    const promptFiles = files.filter((f) => f.includes("prompt") && f.endsWith(".json"));

    if (promptFiles.length > 0) {
      const prompts = await Promise.all(
        promptFiles.map(async (file) => {
          const content = await fs.readFile(path.join(componentsDir, file), "utf-8");
          return JSON.parse(content);
        })
      );

      // Convert component format to prompt format
      const scanResult = componentsToScanResult(prompts);
      return transformScanResultWithDefaults(scanResult);
    }
  } catch {
    // Directory doesn't exist
  }

  return null;
}

async function runNavGatorScan(
  projectPath?: string
): Promise<PromptScanResult | null> {
  // Priority: query param > env var > NavGator directory
  const root = projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");

  try {
    // Try running navgator CLI
    const { stdout } = await execAsync(
      `cd "${root}" && npx navgator prompts --json`,
      { timeout: 30000 }
    );

    return JSON.parse(stdout);
  } catch (error) {
    console.warn("NavGator CLI not available, trying direct scan...");

    // Direct scan via built scanner is not available in Next.js context
    // The scanner must be run via CLI: `navgator scan --prompts`
    console.warn("Direct scan not available in web context. Use CLI: navgator scan --prompts");
    return null;
  }
}

// =============================================================================
// CONVERSION HELPERS
// =============================================================================

interface ArchitectureComponent {
  component_id: string;
  name: string;
  type: string;
  metadata?: Record<string, unknown>;
  source?: { config_files?: string[]; confidence?: number };
  tags?: string[];
  timestamp?: number;
}

function componentsToScanResult(
  components: ArchitectureComponent[]
): PromptScanResult {
  const prompts = components
    .filter((c) => c.type === "prompt")
    .map((c) => ({
      id: c.component_id,
      name: c.name,
      location: {
        file: c.source?.config_files?.[0] || "unknown",
        lineStart: 1,
        lineEnd: 1,
        functionName: c.name,
      },
      messages: [
        {
          role: "user" as const,
          content: String(c.metadata?.userTemplate || c.metadata?.systemPrompt || ""),
        },
      ],
      rawContent: String(c.metadata?.userTemplate || c.metadata?.systemPrompt || ""),
      isTemplate: Boolean(c.metadata?.variables),
      variables: ((c.metadata?.variables as string[]) || []).map((v) => ({
        name: v,
        pattern: `{{${v}}}`,
      })),
      provider: c.metadata?.provider
        ? {
            provider: c.metadata.provider as "openai" | "anthropic" | "unknown",
            model: c.metadata.model as string | undefined,
          }
        : undefined,
      usedBy: [],
      purpose: c.metadata?.purpose as string | undefined,
      tags: c.tags || [],
      category: c.metadata?.category as PromptScanResult["prompts"][0]["category"],
      confidence: c.source?.confidence || 0.8,
      detectionMethod: "heuristic" as const,
      timestamp: c.timestamp || Date.now(),
    }));

  return {
    prompts,
    summary: {
      totalPrompts: prompts.length,
      byProvider: {},
      byCategory: {},
      templatesCount: prompts.filter((p) => p.isTemplate).length,
      withToolsCount: 0,
    },
    warnings: [],
  };
}
