/**
 * API Route: /api/rules
 *
 * Runs architecture rules against stored components/connections.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { RulesApiResponse, RuleViolation } from "@/lib/types";

/**
 * GET /api/rules
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectPath = searchParams.get("path");

  try {
    const root =
      projectPath ||
      process.env.NAVGATOR_PROJECT_PATH ||
      process.cwd().replace(/\/web$/, "");

    const componentsDir = path.join(root, ".claude", "architecture", "components");
    const connectionsDir = path.join(root, ".claude", "architecture", "connections");

    // Load components
    const components = await loadJsonDir(componentsDir);
    const connections = await loadJsonDir(connectionsDir);

    if (components.length === 0) {
      return NextResponse.json<RulesApiResponse>({
        success: true,
        data: {
          violations: [],
          summary: { total: 0, errors: 0, warnings: 0, info: 0 },
        },
        source: "scan",
      });
    }

    // Run rules inline (avoid importing from src which needs compilation)
    const violations = runBuiltinRules(components, connections);

    return NextResponse.json<RulesApiResponse>({
      success: true,
      data: {
        violations,
        summary: {
          total: violations.length,
          errors: violations.filter((v) => v.severity === "error").length,
          warnings: violations.filter((v) => v.severity === "warning").length,
          info: violations.filter((v) => v.severity === "info").length,
        },
      },
      source: "scan",
    });
  } catch (error) {
    console.error("Error running rules:", error);
    return NextResponse.json<RulesApiResponse>({
      success: false,
      data: {
        violations: [],
        summary: { total: 0, errors: 0, warnings: 0, info: 0 },
      },
      error: error instanceof Error ? error.message : "Unknown error",
      source: "scan",
    });
  }
}

async function loadJsonDir(dir: string): Promise<Record<string, unknown>[]> {
  try {
    const files = await fs.readdir(dir);
    const results: Record<string, unknown>[] = [];
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const content = await fs.readFile(path.join(dir, file), "utf-8");
        results.push(JSON.parse(content));
      } catch {
        // Skip invalid files
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Run built-in rules against raw component/connection JSON.
 * This mirrors the rules in src/rules.ts but works on raw JSON objects
 * so we don't need to import from the CLI build.
 */
function runBuiltinRules(
  components: Record<string, unknown>[],
  connections: Record<string, unknown>[]
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  // Helper to get nested values
  const getLayer = (c: Record<string, unknown>) =>
    (c.role as Record<string, unknown> | undefined)?.layer as string | undefined;
  const getId = (c: Record<string, unknown>) => String(c.component_id || "");
  const getName = (c: Record<string, unknown>) => String(c.name || "?");
  const getStatus = (c: Record<string, unknown>) => String(c.status || "active");
  const getFromId = (c: Record<string, unknown>) =>
    String((c.from as Record<string, unknown> | undefined)?.component_id || "");
  const getToId = (c: Record<string, unknown>) =>
    String((c.to as Record<string, unknown> | undefined)?.component_id || "");

  // Rule: Orphan components (0 connections)
  const connectedIds = new Set<string>();
  for (const conn of connections) {
    connectedIds.add(getFromId(conn));
    connectedIds.add(getToId(conn));
  }
  for (const comp of components) {
    if (!connectedIds.has(getId(comp))) {
      violations.push({
        rule_id: "orphan-component",
        severity: "warning",
        component: getName(comp),
        message: `${getName(comp)} has no connections — may be unused or untracked`,
        suggestion: "Verify this component is used, or remove it if not needed",
      });
    }
  }

  // Rule: Frontend direct DB access
  const frontendIds = new Set(
    components.filter((c) => getLayer(c) === "frontend").map(getId)
  );
  const dbIds = new Set(
    components.filter((c) => getLayer(c) === "database").map(getId)
  );
  const compMap = new Map(components.map((c) => [getId(c), c]));

  for (const conn of connections) {
    if (frontendIds.has(getFromId(conn)) && dbIds.has(getToId(conn))) {
      const from = compMap.get(getFromId(conn));
      const to = compMap.get(getToId(conn));
      violations.push({
        rule_id: "frontend-direct-db",
        severity: "error",
        component: from ? getName(from) : undefined,
        message: `${from ? getName(from) : "?"} (frontend) connects directly to ${to ? getName(to) : "?"} (database)`,
        suggestion: "Add a backend API layer between frontend and database",
      });
    }
  }

  // Rule: Unused packages
  for (const comp of components) {
    if (getStatus(comp) === "unused") {
      violations.push({
        rule_id: "unused-package",
        severity: "info",
        component: getName(comp),
        message: `${getName(comp)} is detected but unused`,
        suggestion: `Remove with: npm uninstall ${getName(comp)}`,
      });
    }
  }

  // Rule: Vulnerable dependencies
  for (const comp of components) {
    if (getStatus(comp) === "vulnerable") {
      violations.push({
        rule_id: "vulnerable-dependency",
        severity: "error",
        component: getName(comp),
        message: `${getName(comp)} has known security vulnerabilities`,
        suggestion: "Run npm audit fix or update to a patched version",
      });
    }
  }

  // Rule: Deprecated dependencies
  for (const comp of components) {
    if (getStatus(comp) === "deprecated") {
      violations.push({
        rule_id: "deprecated-dependency",
        severity: "warning",
        component: getName(comp),
        message: `${getName(comp)} is deprecated`,
        suggestion: "Find a replacement package before it becomes unmaintained",
      });
    }
  }

  // Rule: Single point of failure (>5 dependents)
  const dependentCounts = new Map<string, number>();
  for (const conn of connections) {
    const toId = getToId(conn);
    dependentCounts.set(toId, (dependentCounts.get(toId) || 0) + 1);
  }
  for (const comp of components) {
    const id = getId(comp);
    if (getLayer(comp) === "backend" && (dependentCounts.get(id) || 0) > 5) {
      violations.push({
        rule_id: "single-point-of-failure",
        severity: "warning",
        component: getName(comp),
        message: `${getName(comp)} has ${dependentCounts.get(id)} dependents — single point of failure`,
        suggestion: "Consider adding redundancy or splitting responsibilities",
      });
    }
  }

  return violations;
}
