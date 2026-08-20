/**
 * API Route: /api/rules
 *
 * Runs the compiled NavGator rule engine against the selected project. The
 * dashboard intentionally uses `--json`, not agent mode: agent output caps the
 * violation collection at 50 while a human dashboard must expose every item.
 */

import { NextRequest, NextResponse } from "next/server";
import type { RulesApiResponse } from "@/lib/types";
import { resolveProjectPath } from "@/lib/server/project-path";
import { runNavGatorCli } from "@/lib/server/navgator-cli";
import { EMPTY_RULES, hasProjectArchitecture, parseRulesCliOutput } from "../../../lib/server/rules-output";

export async function GET(request: NextRequest) {
  const resolved = resolveProjectPath(request.nextUrl.searchParams);
  if (resolved instanceof NextResponse) return resolved;

  // Do not let the CLI's ancestor discovery substitute a scanned parent for
  // the selected project. A legitimate unscanned project has an empty result.
  if (!hasProjectArchitecture(resolved.root)) {
    return NextResponse.json<RulesApiResponse>({
      success: true,
      data: EMPTY_RULES,
      source: "scan",
    });
  }

  try {
    const { stdout } = await runNavGatorCli(["rules", "--json"], resolved.root, 30_000);
    const data = parseRulesCliOutput(stdout);
    return NextResponse.json<RulesApiResponse>({
      success: true,
      data,
      source: "scan",
    });
  } catch (error) {
    console.error("Error running architecture rules:", error);
    return NextResponse.json<RulesApiResponse>({
      success: false,
      data: {
        violations: [],
        summary: { total: 0, errors: 0, warnings: 0, info: 0 },
      },
      error: "Unable to evaluate architecture rules",
      source: "scan",
    });
  }
}
