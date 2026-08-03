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
import { rejectNonLoopback, rejectUnsafeMutation } from "@/lib/server/request-guard";
import {
  loadRegistry,
  addProject,
  removeProject,
  type RegisteredProject,
} from "@/lib/server/registry-store";

// =============================================================================
// TYPES
// =============================================================================

interface ProjectWithStatus extends RegisteredProject {
  hasArchitecture: boolean;
  componentCount: number;
  connectionCount: number;
  lastScanFormatted: string | null;
}

// =============================================================================
// HELPERS
// =============================================================================

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

export async function GET(request: NextRequest) {
  try {
    // Same loopback boundary /api/coverage enforces. Without it a page on any
    // origin can rebind its hostname to 127.0.0.1 and read this same-origin,
    // exfiltrating every registered absolute project path, name, git branch and
    // commit on the machine — the exact payload class the journal is careful
    // never to record. A simple GET gets no preflight, so SOP does not cover it.
    const nonLoopback = rejectNonLoopback(request);
    if (nonLoopback) return nonLoopback;

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
//
// Concurrent requests to this route are serialized in-process by
// registry-store's mutex. A cross-process race against the CLI is PREVENTED by
// the shared file lock both compilation units take (web/lib/server/registry-lock.ts)
// — not merely detected: the revision compare-and-swap cannot see two writers
// that load the same revision in the same tick, since both then pass their own
// check. Measured on the real registry before the lock existed: 9 collisions,
// 13 registrations silently lost, 0 conflicts recorded.
//
// Not a claim of full atomicity. When the lock cannot be acquired within its
// budget the write proceeds unlocked (recorded as `locked: false` in the
// journal), and POSIX offers no atomic compare-and-swap on a rename.
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

      // The duplicate check lives inside addProject's mutation closure, so a
      // replay after a detected cross-process conflict re-checks against the
      // winner's registry rather than the stale pre-conflict snapshot.
      const { added } = await addProject(resolvedPath, {
        name: extractProjectName(resolvedPath),
        addedAt: Date.now(),
        lastScan: null,
        scanCount: 0,
      });

      if (!added) {
        return NextResponse.json({
          success: true,
          message: "Project already registered",
        });
      }

      return NextResponse.json({
        success: true,
        message: `Registered ${resolvedPath}`,
      });
    }

    if (action === "remove") {
      await removeProject(resolvedPath);

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
