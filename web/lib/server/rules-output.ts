import * as fs from "node:fs"
import * as path from "node:path"
import type { RuleViolation } from "@/lib/types";

export interface RulesCliOutput {
  violations: RuleViolation[];
  summary: { total: number; errors: number; warnings: number; info: number };
}

export const EMPTY_RULES: RulesCliOutput = {
  violations: [],
  summary: { total: 0, errors: 0, warnings: 0, info: 0 },
}

export function hasProjectArchitecture(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, ".navgator", "architecture", "index.json"))
}

export function parseRulesCliOutput(stdout: string): RulesCliOutput {
  const parsed = JSON.parse(stdout) as Partial<RulesCliOutput>;
  if (!Array.isArray(parsed.violations) || !parsed.summary) {
    throw new Error("NavGator rules returned an incompatible response");
  }
  const summary = parsed.summary;
  for (const key of ["total", "errors", "warnings", "info"] as const) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0) {
      throw new Error("NavGator rules returned an incompatible summary");
    }
  }
  return { violations: parsed.violations, summary };
}
