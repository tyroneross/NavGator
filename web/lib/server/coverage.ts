/**
 * Coverage computation for the web dashboard.
 *
 * Mirrors src/coverage.ts semantics (normalized path intersection against the
 * discovered source population, .navgatorignore + noise-dir ignores, capped
 * unmapped-file gaps, identical confidence weighting) but operates on loose
 * JSON records loaded via web/lib/server/architecture-storage.ts instead of
 * typed CLI structures.
 *
 * Deliberately Next.js/alias-free (only fs, path, glob) so tests under
 * src/__tests__/ can import this module by relative path, the pattern proven
 * at src/__tests__/web-architecture-storage.test.ts:5.
 */

import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

export interface CoverageGap {
  type: "unmapped-file" | "low-confidence-connection" | "zero-consumers" | "no-outgoing";
  target: string;
  message: string;
}

export interface CoverageReport {
  overall_confidence: number;
  component_coverage: {
    total_files_in_project: number;
    files_mapped_to_components: number;
    coverage_percent: number;
  };
  connection_coverage: {
    total_connections: number;
    by_confidence: { high: number; medium: number; low: number };
    by_classification: Record<string, number>;
  };
  gaps: CoverageGap[];
}

type Rec = Record<string, unknown>;

function getId(c: Rec): string {
  return String(c.component_id || c.id || "");
}
function getName(c: Rec): string {
  return String(c.name || "?");
}
function getType(c: Rec): string {
  return String(c.type || "");
}
function getLayer(c: Rec): string {
  return String((c.role as Rec | undefined)?.layer || "");
}
function getFromId(c: Rec): string {
  return String((c.from as Rec | undefined)?.component_id || "");
}
function getToId(c: Rec): string {
  return String((c.to as Rec | undefined)?.component_id || "");
}
function getConfidence(c: Rec): number {
  const v = Number(c.confidence);
  return Number.isFinite(v) ? v : 1;
}

/**
 * Normalize a file path (absolute, relative, or mixed separators) to a
 * project-root-relative, forward-slash form. Mirrors src/coverage.ts:214-220.
 */
export function normalizeSourcePath(projectRoot: string, file: string): string {
  const normalizedSeparators = file.replace(/[\\/]/g, path.sep);
  const absolutePath = path.isAbsolute(normalizedSeparators)
    ? path.normalize(normalizedSeparators)
    : path.resolve(projectRoot, normalizedSeparators);
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

/**
 * Discover source files under projectRoot, honoring the same ignore list and
 * optional .navgatorignore as src/coverage.ts:222-247.
 */
export async function discoverSourceFiles(
  projectRoot: string,
  includeMarkdown: boolean
): Promise<string[]> {
  try {
    const ignore = [
      "**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**",
      "**/vendor/**", "**/target/**", "**/.git/**", "**/.navgator/**",
      "**/.rally/**", "**/.build-loop/**", "**/*_files/**",
    ];
    const userIgnore = path.join(projectRoot, ".navgatorignore");
    if (fs.existsSync(userIgnore)) {
      ignore.push(...fs.readFileSync(userIgnore, "utf-8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")));
    }
    const pattern = includeMarkdown
      ? "**/*.{ts,tsx,js,jsx,py,rb,go,rs,swift,java,kt,md}"
      : "**/*.{ts,tsx,js,jsx,py,rb,go,rs,swift,java,kt}";
    return await glob(pattern, { cwd: projectRoot, ignore, absolute: true });
  } catch {
    return [];
  }
}

/**
 * Compute architecture coverage for a project from loose JSON records
 * (as returned by loadArchitectureRecords). Numeric behavior mirrors
 * src/coverage.ts's computeCoverage() exactly.
 */
export async function computeCoverage(
  components: Rec[],
  connections: Rec[],
  projectRoot: string,
  fileMap?: Record<string, string>
): Promise<CoverageReport> {
  const sourceFiles = await discoverSourceFiles(
    projectRoot,
    components.some((component) => getType(component) === "document")
  );
  const sourcePathSet = new Set(
    sourceFiles.map((file) => normalizeSourcePath(projectRoot, file))
  );
  const totalFiles = sourcePathSet.size;

  // Count only unique mapped paths that are part of the source population.
  // file_map can contain stale, generated, absolute, or duplicate path forms;
  // none of those should inflate coverage beyond the files being measured.
  const mappedPathSet = new Set(
    Object.keys(fileMap || {}).map((file) => normalizeSourcePath(projectRoot, file))
  );
  const mappedFiles = [...mappedPathSet].filter((file) => sourcePathSet.has(file)).length;
  const coveragePercent = totalFiles > 0 ? Math.round((mappedFiles / totalFiles) * 100) : 0;

  // Connection confidence breakdown
  let highConf = 0, medConf = 0, lowConf = 0;
  for (const conn of connections) {
    const confidence = getConfidence(conn);
    if (confidence >= 0.8) highConf++;
    else if (confidence >= 0.5) medConf++;
    else lowConf++;
  }

  // Classification counts
  const byClassification: Record<string, number> = {};
  for (const conn of connections) {
    const semantic = conn.semantic as Rec | undefined;
    const classification = String(semantic?.classification || "unclassified");
    byClassification[classification] = (byClassification[classification] || 0) + 1;
  }

  // Identify gaps
  const gaps: CoverageGap[] = [];

  // Unmapped files (sample up to 20)
  if (fileMap) {
    for (const relPath of sourcePathSet) {
      if (!mappedPathSet.has(relPath)) {
        if (gaps.filter((g) => g.type === "unmapped-file").length < 20) {
          gaps.push({
            type: "unmapped-file",
            target: relPath,
            message: `${relPath} is not tracked by any component`,
          });
        }
      }
    }
  }

  // Zero-consumer / no-outgoing components
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  for (const conn of connections) {
    const toId = getToId(conn);
    const fromId = getFromId(conn);
    incomingCounts.set(toId, (incomingCounts.get(toId) || 0) + 1);
    outgoingCounts.set(fromId, (outgoingCounts.get(fromId) || 0) + 1);
  }

  for (const comp of components) {
    const id = getId(comp);
    const layer = getLayer(comp);
    if ((incomingCounts.get(id) || 0) === 0 && layer !== "external") {
      gaps.push({
        type: "zero-consumers",
        target: getName(comp),
        message: `${getName(comp)} has 0 incoming connections`,
      });
    }
    if ((outgoingCounts.get(id) || 0) === 0 && layer !== "database" && layer !== "external") {
      gaps.push({
        type: "no-outgoing",
        target: getName(comp),
        message: `${getName(comp)} has 0 outgoing connections`,
      });
    }
  }

  // Low confidence connections
  for (const conn of connections) {
    const confidence = getConfidence(conn);
    if (confidence < 0.5) {
      gaps.push({
        type: "low-confidence-connection",
        target: String(conn.connection_id || conn.id || ""),
        message: `Connection ${getFromId(conn)} → ${getToId(conn)} has low confidence (${confidence})`,
      });
    }
  }

  // Overall confidence: weighted average of connection confidences + coverage
  const avgConnConfidence = connections.length > 0
    ? connections.reduce((sum, c) => sum + getConfidence(c), 0) / connections.length
    : 0;
  const overallConfidence = connections.length > 0
    ? Math.round(((avgConnConfidence * 0.6) + ((coveragePercent / 100) * 0.4)) * 100) / 100
    : 0;

  return {
    overall_confidence: overallConfidence,
    component_coverage: {
      total_files_in_project: totalFiles,
      files_mapped_to_components: mappedFiles,
      coverage_percent: coveragePercent,
    },
    connection_coverage: {
      total_connections: connections.length,
      by_confidence: { high: highConf, medium: medConf, low: lowConf },
      by_classification: byClassification,
    },
    gaps,
  };
}
