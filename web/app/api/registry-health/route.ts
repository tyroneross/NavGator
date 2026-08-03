/**
 * API Route: /api/registry-health
 *
 * GET  - runs `navgator doctor --json` (registry-global; no project path, so
 *        unlike /api/scan this always runs with cwd = process.cwd()).
 * POST - runs `navgator doctor --fix --yes --json` to prune tmp-rooted/missing
 *        registry entries and orphaned gator-memory records. Destructive, so
 *        it requires an explicit confirm body on top of the mutation guard.
 *
 * The CLI resolves its entry at `process.cwd()/dist/cli/index.js`
 * (see lib/server/navgator-cli.ts). An unbuilt or stale dist/ is a real, expected
 * dev-tree state — every failure path below must return an actionable message,
 * never a blank panel or zeroed-out numbers.
 */

import { NextRequest, NextResponse } from "next/server";
import { rejectNonLoopback, rejectUnsafeMutation } from "@/lib/server/request-guard";
import { runNavGatorCli } from "@/lib/server/navgator-cli";
import type {
  RegistryHealthApiResponse,
  RegistryHealthFixApiResponse,
  RegistryHealthReport,
} from "@/lib/types";

const UNAVAILABLE_MESSAGE =
  "Registry health unavailable. Rebuild the CLI with `npm run build`.";

// The frozen contract's schema_version is semver; only a major-version bump
// signals a shape we don't understand. Minor/patch bumps are additive.
const SUPPORTED_SCHEMA_MAJOR = "1";

function incompatibleMessage(schemaVersion: string): string {
  return `Registry health data is from an incompatible CLI version (got ${schemaVersion}). Rebuild the CLI with \`npm run build\`.`;
}

type DoctorReportWithCleanup = RegistryHealthReport & {
  cleanup?: {
    backupPath: string;
    removedFromRegistry: number;
    removedFromMemory: number;
  };
};

function parseDoctorOutput(
  stdout: string
): { report: DoctorReportWithCleanup } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: UNAVAILABLE_MESSAGE };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).schema_version !== "string"
  ) {
    return { error: UNAVAILABLE_MESSAGE };
  }

  const report = parsed as DoctorReportWithCleanup;
  const major = report.schema_version.split(".")[0];
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return { error: incompatibleMessage(report.schema_version) };
  }

  return { report };
}

export async function GET(request: NextRequest) {
  const nonLoopback = rejectNonLoopback(request);
  if (nonLoopback) return nonLoopback;

  try {
    const { stdout } = await runNavGatorCli(["doctor", "--json"], process.cwd(), 15000);
    const result = parseDoctorOutput(stdout);
    if ("error" in result) {
      return NextResponse.json<RegistryHealthApiResponse>({
        success: false,
        error: result.error,
      });
    }
    return NextResponse.json<RegistryHealthApiResponse>({
      success: true,
      data: result.report,
    });
  } catch (error) {
    console.error("Error running `navgator doctor --json`:", error);
    return NextResponse.json<RegistryHealthApiResponse>({
      success: false,
      error: UNAVAILABLE_MESSAGE,
    });
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<RegistryHealthFixApiResponse>(
      { success: false, error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const { action, confirm } = (body ?? {}) as { action?: unknown; confirm?: unknown };
  if (action !== "prune-tmp" || confirm !== true) {
    return NextResponse.json<RegistryHealthFixApiResponse>(
      {
        success: false,
        error: 'Cleanup requires a confirmed request body: { "action": "prune-tmp", "confirm": true }',
      },
      { status: 400 }
    );
  }

  try {
    const { stdout } = await runNavGatorCli(
      ["doctor", "--fix", "--yes", "--json"],
      process.cwd(),
      15000
    );
    const result = parseDoctorOutput(stdout);
    if ("error" in result) {
      return NextResponse.json<RegistryHealthFixApiResponse>({
        success: false,
        error: result.error,
      });
    }
    if (!result.report.cleanup) {
      // Ran and parsed, but the CLI didn't attach a cleanup summary — treat
      // as the same "incompatible/unavailable" family rather than silently
      // rendering success with no cleanup counts.
      return NextResponse.json<RegistryHealthFixApiResponse>({
        success: false,
        error: UNAVAILABLE_MESSAGE,
      });
    }
    const { cleanup, ...report } = result.report;
    return NextResponse.json<RegistryHealthFixApiResponse>({
      success: true,
      data: { ...(report as RegistryHealthReport), cleanup },
    });
  } catch (error) {
    console.error("Error running `navgator doctor --fix --yes --json`:", error);
    return NextResponse.json<RegistryHealthFixApiResponse>({
      success: false,
      error: UNAVAILABLE_MESSAGE,
    });
  }
}
