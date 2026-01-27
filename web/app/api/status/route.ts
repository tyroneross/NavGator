/**
 * API Route: /api/status
 *
 * Returns project status and metadata from NavGator scans.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { StatusApiResponse, ProjectStatus } from "@/lib/types";

// Cache for status data
let cachedData: ProjectStatus | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 second cache

/**
 * GET /api/status
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

  // Check cache
  if (!refresh && cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json<StatusApiResponse>({
      success: true,
      data: cachedData,
      source: "cache",
    });
  }

  try {
    const data = await loadStatusData(projectPath);

    if (data) {
      cachedData = data;
      cacheTimestamp = Date.now();

      return NextResponse.json<StatusApiResponse>({
        success: true,
        data,
        source: "scan",
      });
    }

    // No scan data - return empty state
    return NextResponse.json<StatusApiResponse>({
      success: true,
      data: getEmptyStatus(projectPath),
      source: "scan",
      error: "No scan data found. Run `navgator setup` to scan your project.",
    });
  } catch (error) {
    console.error("Error loading status data:", error);
    return NextResponse.json<StatusApiResponse>({
      success: false,
      data: getEmptyStatus(projectPath),
      source: "scan",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadStatusData(projectPath?: string | null): Promise<ProjectStatus | null> {
  // Priority: query param > env var > NavGator directory
  const root = projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");
  const indexPath = path.join(root, ".claude", "architecture", "index.json");

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);

    // Extract project name from path
    const projectName = extractProjectName(root);

    return {
      project_path: root,
      project_name: projectName,
      last_scan: index.last_scan || null,
      last_scan_formatted: index.last_scan
        ? formatRelativeTime(index.last_scan)
        : null,
      stats: {
        total_components: index.stats?.total_components || 0,
        total_connections: index.stats?.total_connections || 0,
        components_by_type: index.stats?.components_by_type || {},
        connections_by_type: index.stats?.connections_by_type || {},
        outdated_count: index.stats?.outdated_count || 0,
        vulnerable_count: index.stats?.vulnerable_count || 0,
      },
    };
  } catch {
    return null;
  }
}

function extractProjectName(projectPath: string): string {
  // Try to read package.json for a proper name
  try {
    const packageJsonPath = path.join(projectPath, "package.json");
    // Use sync read since we're in a helper function
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packageJson = require(packageJsonPath);
    if (packageJson.name) {
      return formatProjectName(packageJson.name);
    }
  } catch {
    // Fall back to directory name
  }

  // Extract from path - get last segment and format
  const segments = projectPath.split(path.sep).filter(Boolean);
  const dirName = segments[segments.length - 1] || "project";
  return formatProjectName(dirName);
}

function formatProjectName(name: string): string {
  // Convert kebab-case, snake_case, etc to Title Case
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

function getEmptyStatus(projectPath?: string | null): ProjectStatus {
  // Priority: query param > env var > NavGator directory
  const root = projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");
  return {
    project_path: root,
    project_name: extractProjectName(root),
    last_scan: null,
    last_scan_formatted: null,
    stats: {
      total_components: 0,
      total_connections: 0,
      components_by_type: {},
      connections_by_type: {},
      outdated_count: 0,
      vulnerable_count: 0,
    },
  };
}
