/**
 * API Route: /api/coverage
 *
 * Computes architecture coverage and identifies gaps from the consolidated
 * .navgator/architecture/ storage (loadArchitectureRecords), delegating the
 * computation to web/lib/server/coverage.ts, which mirrors src/coverage.ts
 * semantics numerically.
 */

import { NextRequest, NextResponse } from "next/server";
import type { CoverageApiResponse, CoverageReport } from "@/lib/types";
import { loadArchitectureRecords } from "@/lib/server/architecture-storage";
import { computeCoverage } from "@/lib/server/coverage";

const coverageCache = new Map<string, { data: CoverageReport; timestamp: number }>();
const CACHE_TTL = 60000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

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

    coverageCache.set(cacheKey, { data: report, timestamp: Date.now() });

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
