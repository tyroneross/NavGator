import type { RuleViolation } from "@/lib/types";

export interface RulesCliOutput {
  violations: RuleViolation[];
  summary: { total: number; errors: number; warnings: number; info: number };
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
