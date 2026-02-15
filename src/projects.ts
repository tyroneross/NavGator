/**
 * NavGator Project Registry
 * Manages ~/.navgator/projects.json with enhanced per-project context
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiffSignificance, GitInfo } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface ProjectEntry {
  path: string;
  name: string;
  addedAt: number;
  lastScan: number | null;
  scanCount: number;
  stats?: {
    components: number;
    connections: number;
    prompts: number;
  };
  lastSignificantChange?: number;
  lastSignificance?: DiffSignificance;
  git?: { branch: string; commit: string };
}

interface ProjectRegistry {
  version: number;
  projects: ProjectEntry[];
}

// =============================================================================
// REGISTRY I/O
// =============================================================================

function getRegistryDir(): string {
  return path.join(os.homedir(), '.navgator');
}

function getRegistryPath(): string {
  return path.join(getRegistryDir(), 'projects.json');
}

/**
 * Load the project registry with v1→v2 auto-migration
 */
export async function loadRegistry(): Promise<ProjectRegistry> {
  const registryPath = getRegistryPath();
  try {
    const content = await fs.promises.readFile(registryPath, 'utf-8');
    const raw = JSON.parse(content) as ProjectRegistry;

    // v1→v2 migration: add missing fields
    if (raw.version === 1) {
      raw.version = 2;
      for (const p of raw.projects) {
        if (p.scanCount === undefined) p.scanCount = p.lastScan ? 1 : 0;
      }
    }

    return raw;
  } catch {
    return { version: 2, projects: [] };
  }
}

/**
 * Save the project registry
 */
export async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  const registryDir = getRegistryDir();
  await fs.promises.mkdir(registryDir, { recursive: true });
  await fs.promises.writeFile(
    getRegistryPath(),
    JSON.stringify(registry, null, 2),
    'utf-8'
  );
}

// =============================================================================
// REGISTRATION
// =============================================================================

/**
 * Register or update a project after scan.
 * Replaces the inline registry code previously in cli/index.ts.
 */
export async function registerProject(
  projectRoot: string,
  stats?: { components: number; connections: number; prompts: number },
  significance?: DiffSignificance,
  gitInfo?: GitInfo
): Promise<void> {
  try {
    const registry = await loadRegistry();

    const existing = registry.projects.find((p) => p.path === projectRoot);
    if (existing) {
      existing.lastScan = Date.now();
      existing.scanCount = (existing.scanCount || 0) + 1;
      if (stats) existing.stats = stats;
      if (significance && significance !== 'patch') {
        existing.lastSignificantChange = Date.now();
        existing.lastSignificance = significance;
      }
      if (gitInfo) {
        existing.git = { branch: gitInfo.branch, commit: gitInfo.commit };
      }
    } else {
      const dirName = projectRoot.split(path.sep).pop() || 'project';
      const name = dirName
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      registry.projects.push({
        path: projectRoot,
        name,
        addedAt: Date.now(),
        lastScan: Date.now(),
        scanCount: 1,
        stats,
        lastSignificantChange: significance && significance !== 'patch' ? Date.now() : undefined,
        lastSignificance: significance && significance !== 'patch' ? significance : undefined,
        git: gitInfo ? { branch: gitInfo.branch, commit: gitInfo.commit } : undefined,
      });
    }

    await saveRegistry(registry);
  } catch {
    // Non-critical — don't fail the scan
  }
}

// =============================================================================
// LISTING
// =============================================================================

/**
 * List all registered projects
 */
export async function listProjects(): Promise<ProjectEntry[]> {
  const registry = await loadRegistry();
  return registry.projects;
}

/**
 * Format the project list for CLI display
 */
export function formatProjectsList(projects: ProjectEntry[], json?: boolean): string {
  if (json) {
    return JSON.stringify(projects, null, 2);
  }

  if (projects.length === 0) {
    return 'No projects registered yet. Run `navgator scan` in a project to register it.';
  }

  const lines: string[] = [];
  lines.push('Registered Projects');
  lines.push('─'.repeat(60));

  for (const p of projects) {
    const lastScan = p.lastScan
      ? timeSince(p.lastScan)
      : 'never';
    const stale = p.lastScan && (Date.now() - p.lastScan) > 24 * 60 * 60 * 1000;
    const staleIndicator = stale ? ' (stale)' : '';

    lines.push('');
    lines.push(`  ${p.name}${staleIndicator}`);
    lines.push(`  ${p.path}`);
    lines.push(`  Scans: ${p.scanCount || 0} | Last: ${lastScan}`);

    if (p.stats) {
      lines.push(`  Components: ${p.stats.components} | Connections: ${p.stats.connections} | Prompts: ${p.stats.prompts}`);
    }

    if (p.git) {
      lines.push(`  Branch: ${p.git.branch} @ ${p.git.commit}`);
    }

    if (p.lastSignificance && p.lastSignificantChange) {
      lines.push(`  Last significant change: ${p.lastSignificance.toUpperCase()} (${timeSince(p.lastSignificantChange)})`);
    }
  }

  return lines.join('\n');
}

function timeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
