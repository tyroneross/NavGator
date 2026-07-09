/**
 * API Route: /api/scan
 *
 * Triggers a NavGator scan and returns combined results.
 */

import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import { runNavGatorCli } from "@/lib/server/navgator-cli";
import { rejectUnsafeMutation } from "@/lib/server/request-guard";

interface ScanResponse {
  success: boolean;
  status: "completed" | "noop" | "busy" | "error";
  retryable?: boolean;
  message: string;
  timestamp: string;
  results?: {
    components: number;
    connections: number;
    prompts: number;
  };
  error?: string;
}

interface CliScanResult {
  status: "completed" | "noop" | "busy";
  retryable?: boolean;
  message?: string;
  components_found?: number;
  connections_found?: number;
  prompts_found?: number;
}

function parseScanResult(stdout: string): CliScanResult {
  const parsed = JSON.parse(stdout) as Partial<CliScanResult>;
  if (!parsed || !["completed", "noop", "busy"].includes(String(parsed.status))) {
    throw new Error("NavGator CLI returned an invalid scan status");
  }
  return parsed as CliScanResult;
}

/**
 * POST /api/scan
 *
 * Triggers a full NavGator scan
 */
export async function POST(request: NextRequest) {
  try {
    const rejected = rejectUnsafeMutation(request);
    if (rejected) return rejected;
    const body = await request.json().catch(() => ({}));
    const projectPath = path.resolve(
      /* turbopackIgnore: true */ body.path || process.env.NAVGATOR_PROJECT_PATH || process.cwd().replace(/\/web$/, ""),
    );
    const includePrompts = body.prompts !== false;

    const args = ["scan", "--json"];
    if (includePrompts) args.push("--prompts");
    let result: CliScanResult;
    try {
      const { stdout } = await runNavGatorCli(args, projectPath, 60000);
      result = parseScanResult(stdout);
    } catch (error) {
      const cliError = error as { code?: number | string; stdout?: string };
      if (Number(cliError.code) !== 2 || typeof cliError.stdout !== "string") throw error;
      result = parseScanResult(cliError.stdout);
    }

    if (result.status === "busy") {
      return NextResponse.json<ScanResponse>({
        success: false,
        status: result.status,
        retryable: result.retryable ?? true,
        message: result.message || "Another NavGator scan is already running",
        timestamp: new Date().toISOString(),
      }, { status: 409 });
    }

    return NextResponse.json<ScanResponse>({
      success: true,
      status: result.status,
      message: result.status === "noop" ? "Architecture is already current" : "Scan completed successfully",
      timestamp: new Date().toISOString(),
      results: {
        components: result.components_found ?? 0,
        connections: result.connections_found ?? 0,
        prompts: result.prompts_found ?? 0,
      },
    });
  } catch (error) {
    console.error("Scan error:", error);

    return NextResponse.json<ScanResponse>(
      {
        success: false,
        status: "error",
        message: "Scan failed",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/scan
 *
 * Returns scan status/health
 */
export async function GET() {
  try {
    const projectPath = path.resolve(
      /* turbopackIgnore: true */ process.env.NAVGATOR_PROJECT_PATH || process.cwd().replace(/\/web$/, ""),
    );

    const { stdout } = await runNavGatorCli(["--version"], projectPath, 10000);

    return NextResponse.json({
      available: true,
      version: stdout.trim(),
      projectPath,
    });
  } catch {
    return NextResponse.json({
      available: false,
      message: "Packaged NavGator CLI is not available.",
    });
  }
}
