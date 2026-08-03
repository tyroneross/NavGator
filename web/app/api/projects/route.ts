/**
 * API Route: /api/projects
 *
 * Manages the project registry at ~/.navgator/projects.json
 * GET  - List all registered projects with validation
 * POST - Register or remove a project
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import { readFileSync } from "fs";
import * as path from "path";
import * as os from "os";
import { rejectUnsafeMutation } from "@/lib/server/request-guard";

// =============================================================================
// TYPES
// =============================================================================

interface RegisteredProject {
  path: string;
  name: string;
  addedAt: number;
  lastScan: number | null;
  // Optional fields owned by src/projects.ts's richer ProjectEntry shape.
  // This route never reconstructs an existing entry (GET spreads `...project`,
  // POST only pushes brand-new entries) so these are never stripped from
  // sibling entries on a read-modify-write — declared here only so the
  // types below don't have to widen to `any`.
  scanCount?: number;
  stats?: { components: number; connections: number; prompts: number };
  git?: { branch: string; commit: string };
  origin?: { kind: 'local' | 'remote'; url?: string; cachePath?: string };
  portfolio?: { root: string };
}

interface ProjectRegistry {
  version: 2;
  projects: RegisteredProject[];
}

interface ProjectWithStatus extends RegisteredProject {
  hasArchitecture: boolean;
  componentCount: number;
  connectionCount: number;
  lastScanFormatted: string | null;
}

// =============================================================================
// REGISTRY PATH
// =============================================================================

const REGISTRY_DIR = path.join(os.homedir(), ".navgator");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "projects.json");

// =============================================================================
// HELPERS
// =============================================================================

async function loadRegistry(): Promise<ProjectRegistry> {
  try {
    const content = await fs.readFile(REGISTRY_PATH, "utf-8");
    const raw = JSON.parse(content) as { version?: number; projects: RegisteredProject[] };
    // This route is a secondary writer of the same registry src/projects.ts
    // owns; align on version 2 so a save from here doesn't regress a v1
    // literal into a file src/projects.ts has already migrated forward.
    return { version: 2, projects: raw.projects ?? [] };
  } catch {
    return { version: 2, projects: [] };
  }
}

async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  // Write through a temp file and rename. A plain writeFile here can be observed
  // half-written by src/projects.ts's loadRegistry, which parse-fails to an EMPTY
  // registry rather than an error — so a torn write from this route reads as
  // "no projects registered" on the CLI side. Rename is atomic on the same
  // filesystem, so a concurrent reader sees either the old file or the new one.
  //
  // This is the same defect class as the in-process registry race fixed in
  // src/projects.ts, at the one writer that lives outside that module's mutex.
  // Cross-PROCESS lost-update between this route and the CLI remains possible
  // and is out of scope; atomicity only removes the torn-file failure.
  const tmp = `${REGISTRY_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(registry, null, 2), "utf-8");
  await fs.rename(tmp, REGISTRY_PATH);
}

function extractProjectName(projectPath: string): string {
  try {
    const packageJsonPath = path.join(projectPath, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (packageJson.name) {
      return packageJson.name
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
        .trim();
    }
  } catch {
    // fall through
  }
  const segments = projectPath.split(path.sep).filter(Boolean);
  return (segments[segments.length - 1] || "project")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
    .trim();
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function enrichProject(project: RegisteredProject): Promise<ProjectWithStatus> {
  const indexPath = path.join(project.path, ".navgator", "architecture", "index.json");
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    const index = JSON.parse(content);
    return {
      ...project,
      name: extractProjectName(project.path),
      hasArchitecture: true,
      componentCount: index.stats?.total_components || 0,
      connectionCount: index.stats?.total_connections || 0,
      lastScan: index.last_scan || project.lastScan,
      lastScanFormatted: index.last_scan ? formatRelativeTime(index.last_scan) : null,
    };
  } catch {
    return {
      ...project,
      hasArchitecture: false,
      componentCount: 0,
      connectionCount: 0,
      lastScanFormatted: project.lastScan ? formatRelativeTime(project.lastScan) : null,
    };
  }
}

// =============================================================================
// GET /api/projects
// =============================================================================

export async function GET() {
  try {
    const registry = await loadRegistry();

    // Enrich each project with live status
    const projects = await Promise.all(
      registry.projects.map((p) => enrichProject(p))
    );

    return NextResponse.json({
      success: true,
      data: { projects },
    });
  } catch (error) {
    console.error("Error loading projects:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST /api/projects
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const rejected = rejectUnsafeMutation(request);
    if (rejected) return rejected;
    const body = await request.json();
    const { action, path: projectPath } = body as { action: "add" | "remove"; path: string };

    if (!projectPath) {
      return NextResponse.json(
        { success: false, error: "Missing project path" },
        { status: 400 }
      );
    }

    const resolvedPath = path.resolve(projectPath);
    const registry = await loadRegistry();

    if (action === "add") {
      // Check if directory exists
      try {
        await fs.access(resolvedPath);
      } catch {
        return NextResponse.json(
          { success: false, error: `Directory not found: ${resolvedPath}` },
          { status: 400 }
        );
      }

      // Don't add duplicates
      if (registry.projects.some((p) => p.path === resolvedPath)) {
        return NextResponse.json({
          success: true,
          message: "Project already registered",
        });
      }

      registry.projects.push({
        path: resolvedPath,
        name: extractProjectName(resolvedPath),
        addedAt: Date.now(),
        lastScan: null,
        scanCount: 0,
      });

      await saveRegistry(registry);

      return NextResponse.json({
        success: true,
        message: `Registered ${resolvedPath}`,
      });
    }

    if (action === "remove") {
      registry.projects = registry.projects.filter((p) => p.path !== resolvedPath);
      await saveRegistry(registry);

      return NextResponse.json({
        success: true,
        message: `Removed ${resolvedPath}`,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating projects:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
