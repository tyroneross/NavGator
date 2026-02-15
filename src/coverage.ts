/**
 * NavGator Coverage / Confidence Reporting
 * Measures architecture tracking coverage and identifies gaps
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ArchitectureComponent, ArchitectureConnection, ArchitectureLayer } from './types.js';

export interface CoverageGap {
  type: 'unmapped-file' | 'low-confidence-connection' | 'zero-consumers' | 'no-outgoing';
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

/**
 * Compute architecture coverage for a project.
 */
export async function computeCoverage(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[],
  projectRoot: string,
  fileMap?: Record<string, string>
): Promise<CoverageReport> {
  // Count project source files
  const sourceFiles = await discoverSourceFiles(projectRoot);
  const totalFiles = sourceFiles.length;

  // Count mapped files
  const mappedFiles = fileMap ? Object.keys(fileMap).length : 0;
  const coveragePercent = totalFiles > 0 ? Math.round((mappedFiles / totalFiles) * 100) : 0;

  // Connection confidence breakdown
  let highConf = 0, medConf = 0, lowConf = 0;
  for (const conn of connections) {
    if (conn.confidence >= 0.8) highConf++;
    else if (conn.confidence >= 0.5) medConf++;
    else lowConf++;
  }

  // Classification counts
  const byClassification: Record<string, number> = {};
  for (const conn of connections) {
    const classification = (conn as any).semantic?.classification || 'unclassified';
    byClassification[classification] = (byClassification[classification] || 0) + 1;
  }

  // Identify gaps
  const gaps: CoverageGap[] = [];

  // Unmapped files (sample up to 20)
  if (fileMap) {
    const mappedSet = new Set(Object.keys(fileMap).map(f => f.toLowerCase()));
    let unmappedCount = 0;
    for (const file of sourceFiles) {
      const relPath = path.relative(projectRoot, file);
      if (!mappedSet.has(relPath.toLowerCase())) {
        unmappedCount++;
        if (gaps.filter(g => g.type === 'unmapped-file').length < 20) {
          gaps.push({
            type: 'unmapped-file',
            target: relPath,
            message: `${relPath} is not tracked by any component`,
          });
        }
      }
    }
  }

  // Zero-consumer components (no incoming connections in production path)
  const incomingCounts = new Map<string, number>();
  for (const conn of connections) {
    incomingCounts.set(conn.to.component_id, (incomingCounts.get(conn.to.component_id) || 0) + 1);
  }
  for (const comp of components) {
    if ((incomingCounts.get(comp.component_id) || 0) === 0 && comp.role.layer !== 'external') {
      gaps.push({
        type: 'zero-consumers',
        target: comp.name,
        message: `${comp.name} has 0 incoming connections`,
      });
    }
  }

  // No-outgoing components
  const outgoingCounts = new Map<string, number>();
  for (const conn of connections) {
    outgoingCounts.set(conn.from.component_id, (outgoingCounts.get(conn.from.component_id) || 0) + 1);
  }
  for (const comp of components) {
    if ((outgoingCounts.get(comp.component_id) || 0) === 0 &&
        comp.role.layer !== 'database' && comp.role.layer !== 'external') {
      gaps.push({
        type: 'no-outgoing',
        target: comp.name,
        message: `${comp.name} has 0 outgoing connections`,
      });
    }
  }

  // Low confidence connections
  for (const conn of connections) {
    if (conn.confidence < 0.5) {
      gaps.push({
        type: 'low-confidence-connection',
        target: conn.connection_id,
        message: `Connection ${conn.from.component_id} → ${conn.to.component_id} has low confidence (${conn.confidence})`,
      });
    }
  }

  // Overall confidence: weighted average of connection confidences + coverage
  const avgConnConfidence = connections.length > 0
    ? connections.reduce((sum, c) => sum + c.confidence, 0) / connections.length
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

/**
 * Format coverage report for human-readable CLI output
 */
export function formatCoverageOutput(report: CoverageReport, gapsOnly: boolean = false): string {
  const lines: string[] = [];

  if (!gapsOnly) {
    lines.push('NavGator - Architecture Coverage Report');
    lines.push('');
    lines.push(`Overall confidence: ${Math.round(report.overall_confidence * 100)}%`);
    lines.push('');
    lines.push('FILE COVERAGE:');
    lines.push(`  Project files: ${report.component_coverage.total_files_in_project}`);
    lines.push(`  Mapped to components: ${report.component_coverage.files_mapped_to_components}`);
    lines.push(`  Coverage: ${report.component_coverage.coverage_percent}%`);
    lines.push('');
    lines.push('CONNECTION CONFIDENCE:');
    lines.push(`  High (≥0.8): ${report.connection_coverage.by_confidence.high}`);
    lines.push(`  Medium (0.5-0.8): ${report.connection_coverage.by_confidence.medium}`);
    lines.push(`  Low (<0.5): ${report.connection_coverage.by_confidence.low}`);

    if (Object.keys(report.connection_coverage.by_classification).length > 0) {
      lines.push('');
      lines.push('BY CLASSIFICATION:');
      for (const [cls, count] of Object.entries(report.connection_coverage.by_classification)) {
        lines.push(`  ${cls}: ${count}`);
      }
    }
    lines.push('');
  }

  if (report.gaps.length > 0) {
    lines.push(`GAPS (${report.gaps.length}):`);
    const byType = new Map<string, CoverageGap[]>();
    for (const gap of report.gaps) {
      if (!byType.has(gap.type)) byType.set(gap.type, []);
      byType.get(gap.type)!.push(gap);
    }

    for (const [type, gapList] of byType) {
      lines.push(`  ${type} (${gapList.length}):`);
      for (const gap of gapList.slice(0, 10)) {
        lines.push(`    - ${gap.message}`);
      }
      if (gapList.length > 10) {
        lines.push(`    ... and ${gapList.length - 10} more`);
      }
    }
  } else {
    lines.push('No coverage gaps detected.');
  }

  return lines.join('\n');
}

async function discoverSourceFiles(projectRoot: string): Promise<string[]> {
  try {
    return await glob('**/*.{ts,tsx,js,jsx,py,rb,go,rs,swift,java,kt}', {
      cwd: projectRoot,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/vendor/**', '**/target/**'],
      absolute: true,
    });
  } catch {
    return [];
  }
}
