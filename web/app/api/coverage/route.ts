/**
 * API Route: /api/coverage
 *
 * Computes architecture coverage and identifies gaps from the consolidated
 * .navgator/architecture/ storage (loadArchitectureRecords), delegating the
 * computation to web/lib/server/coverage.ts, which mirrors src/coverage.ts
 * semantics numerically.
 */

import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as os from "os";
import type { CoverageApiResponse, CoverageReport } from "@/lib/types";
import { loadArchitectureRecords } from "@/lib/server/architecture-storage";
import {
  computeCoverage,
  isRegisteredProjectPath,
  setBoundedCacheEntry,
} from "@/lib/server/coverage";
import { rejectNonLoopback } from "@/lib/server/request-guard";

const coverageCache = new Map<string, { data: CoverageReport; timestamp: number }>();
const CACHE_TTL = 60000;
// Bounds coverageCache's memory footprint. Without a cap, an attacker-chosen
// `path` (now constrained to registered projects, but bounded defensively
// anyway) could otherwise grow the map without limit across many distinct
// root directories.
const CACHE_MAX_ENTRIES = 20;

const REGISTRY_PATH = path.join(os.homedir(), ".navgator", "projects.json");

export async function GET(request: NextRequest) {
  const nonLoopback = rejectNonLoopback(request);
  if (nonLoopback) return nonLoopback;

  const searchParams = request.nextUrl.searchParams;
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

  if (projectPath && !isRegisteredProjectPath(projectPath, REGISTRY_PATH)) {
    return NextResponse.json<CoverageApiResponse>(
      {
        success: false,
        error: "path must match a registered NavGator project",
        source: "scan",
      },
      { status: 400 }
    );
  }

  const root =
    projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");

  const cacheKey = root;
  const cached = coverageCache.get(cacheKey);

  if (!refresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json<CoverageApiResponse>({
      success: true,
      data: cached.data,
      source: "cache",
    });
  }

  try {
    const records = await loadArchitectureRecords(root);
    const report = await computeCoverage(
      records.components,
      records.connections,
      root,
      records.fileMap
    );

    setBoundedCacheEntry(coverageCache, cacheKey, report, CACHE_MAX_ENTRIES);

    return NextResponse.json<CoverageApiResponse>({
      success: true,
      data: report,
      source: "scan",
    });
  } catch (error) {
    console.error("Error computing coverage:", error);
    return NextResponse.json<CoverageApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      source: "scan",
    });
  }
}
