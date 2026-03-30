/**
 * Cron Job Scanner
 * Detects scheduled jobs from vercel.json crons, railway config, and crontab patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// CRON DEFINITIONS
// =============================================================================

interface CronDefinition {
  path: string;              // API route path (e.g., /api/cron/sync)
  schedule: string;          // Cron expression
  description?: string;
  source: string;            // Config file where defined
  platform: string;          // vercel, railway, generic
}

// =============================================================================
// VERCEL CRONS
// =============================================================================

/**
 * Parse vercel.json for crons array
 */
function parseVercelCrons(projectRoot: string): { crons: CronDefinition[]; warnings: ScanWarning[] } {
  const crons: CronDefinition[] = [];
  const warnings: ScanWarning[] = [];
  const configPath = path.join(projectRoot, 'vercel.json');

  if (!fs.existsSync(configPath)) return { crons, warnings };

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    if (Array.isArray(config.crons)) {
      for (const cron of config.crons) {
        if (cron.path && cron.schedule) {
          crons.push({
            path: cron.path,
            schedule: cron.schedule,
            description: describeCronSchedule(cron.schedule),
            source: 'vercel.json',
            platform: 'vercel',
          });
        }
      }
    }
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse vercel.json: ${error instanceof Error ? error.message : 'Unknown'}`,
      file: 'vercel.json',
    });
  }

  return { crons, warnings };
}

// =============================================================================
// RAILWAY CRONS
// =============================================================================

/**
 * Parse railway.json/railway.toml for cron services
 */
function parseRailwayCrons(projectRoot: string): { crons: CronDefinition[]; warnings: ScanWarning[] } {
  const crons: CronDefinition[] = [];
  const warnings: ScanWarning[] = [];

  // railway.json
  const jsonPath = path.join(projectRoot, 'railway.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const config = JSON.parse(content);

      // Railway v2 config: deploy.cronSchedule
      if (config.deploy?.cronSchedule) {
        crons.push({
          path: config.deploy.startCommand || 'railway-cron',
          schedule: config.deploy.cronSchedule,
          description: describeCronSchedule(config.deploy.cronSchedule),
          source: 'railway.json',
          platform: 'railway',
        });
      }

      // Railway services array
      if (Array.isArray(config.services)) {
        for (const svc of config.services) {
          if (svc.cronSchedule) {
            crons.push({
              path: svc.startCommand || svc.name || 'railway-service',
              schedule: svc.cronSchedule,
              description: describeCronSchedule(svc.cronSchedule),
              source: 'railway.json',
              platform: 'railway',
            });
          }
        }
      }
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse railway.json: ${error instanceof Error ? error.message : 'Unknown'}`,
        file: 'railway.json',
      });
    }
  }

  // railway.toml
  const tomlPath = path.join(projectRoot, 'railway.toml');
  if (fs.existsSync(tomlPath)) {
    try {
      const content = fs.readFileSync(tomlPath, 'utf-8');

      // Match cronSchedule = "..." in TOML
      const cronMatch = content.match(/cronSchedule\s*=\s*"([^"]+)"/);
      if (cronMatch) {
        // Find associated startCommand
        const startMatch = content.match(/startCommand\s*=\s*"([^"]+)"/);
        crons.push({
          path: startMatch?.[1] || 'railway-cron',
          schedule: cronMatch[1],
          description: describeCronSchedule(cronMatch[1]),
          source: 'railway.toml',
          platform: 'railway',
        });
      }
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse railway.toml: ${error instanceof Error ? error.message : 'Unknown'}`,
        file: 'railway.toml',
      });
    }
  }

  return { crons, warnings };
}

// =============================================================================
// GENERIC CRON PATTERNS (node-cron, cron npm package)
// =============================================================================

/**
 * Scan for programmatic cron job definitions in source code
 */
async function findCodeCrons(projectRoot: string): Promise<{ crons: CronDefinition[]; warnings: ScanWarning[] }> {
  const crons: CronDefinition[] = [];
  const warnings: ScanWarning[] = [];

  // Only scan if node-cron or cron package is installed
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return { crons, warnings };

  let hasCronPkg = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    hasCronPkg = !!(allDeps['node-cron'] || allDeps.cron || allDeps['cron-parser']);
  } catch {
    return { crons, warnings };
  }

  if (!hasCronPkg) return { crons, warnings };

  // Scan source files for cron.schedule('expression', handler) patterns
  const { glob: globFn } = await import('glob');
  const sourceFiles = await globFn('**/*.{ts,tsx,js,jsx,mjs}', {
    cwd: projectRoot,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/.git/**'],
  });

  for (const file of sourceFiles) {
    try {
      const content = await fs.promises.readFile(path.join(projectRoot, file), 'utf-8');

      // cron.schedule('* * * * *', handler)
      const schedulePattern = /(?:cron\.schedule|new\s+CronJob)\s*\(\s*['"`]([^'"`]+)['"`]/g;
      let match: RegExpExecArray | null;

      while ((match = schedulePattern.exec(content)) !== null) {
        crons.push({
          path: file,
          schedule: match[1],
          description: describeCronSchedule(match[1]),
          source: file,
          platform: 'node-cron',
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return { crons, warnings };
}

// =============================================================================
// SCHEDULE DESCRIPTION
// =============================================================================

/**
 * Generate a human-readable description of a cron schedule
 */
function describeCronSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);

  // Common patterns
  if (schedule === '* * * * *') return 'Every minute';
  if (schedule === '*/5 * * * *') return 'Every 5 minutes';
  if (schedule === '*/10 * * * *') return 'Every 10 minutes';
  if (schedule === '*/15 * * * *') return 'Every 15 minutes';
  if (schedule === '*/30 * * * *') return 'Every 30 minutes';
  if (schedule === '0 * * * *') return 'Every hour';
  if (schedule === '0 0 * * *') return 'Daily at midnight';
  if (schedule === '0 0 * * 0') return 'Weekly on Sunday';
  if (schedule === '0 0 1 * *') return 'Monthly on the 1st';

  if (parts.length >= 5) {
    const [min, hour, dom, mon, dow] = parts;
    if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
      return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (min.startsWith('*/')) {
      return `Every ${min.slice(2)} minutes`;
    }
    if (hour.startsWith('*/')) {
      return `Every ${hour.slice(2)} hours`;
    }
  }

  return schedule;
}

// =============================================================================
// ROUTE RESOLVER
// =============================================================================

/**
 * Try to resolve a cron path to an API route handler file
 */
function resolveApiRoute(projectRoot: string, cronPath: string): string | null {
  // /api/cron/sync -> try common patterns
  const candidates = [
    // Next.js App Router
    `app${cronPath}/route.ts`,
    `app${cronPath}/route.js`,
    `src/app${cronPath}/route.ts`,
    `src/app${cronPath}/route.js`,
    // Next.js Pages Router
    `pages${cronPath}.ts`,
    `pages${cronPath}.js`,
    `src/pages${cronPath}.ts`,
    `src/pages${cronPath}.js`,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(projectRoot, candidate))) {
      return candidate;
    }
  }

  return null;
}

// =============================================================================
// SCANNER
// =============================================================================

/**
 * Scan for cron job definitions
 */
export async function scanCronJobs(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Gather crons from all sources
  const vercelResult = parseVercelCrons(projectRoot);
  const railwayResult = parseRailwayCrons(projectRoot);
  const codeResult = await findCodeCrons(projectRoot);

  const allCrons = [
    ...vercelResult.crons,
    ...railwayResult.crons,
    ...codeResult.crons,
  ];
  warnings.push(
    ...vercelResult.warnings,
    ...railwayResult.warnings,
    ...codeResult.warnings,
  );

  if (allCrons.length === 0) {
    return { components, connections, warnings };
  }

  for (const cron of allCrons) {
    const componentId = generateComponentId('cron', cron.path.replace(/\//g, '_'));

    components.push({
      component_id: componentId,
      name: cron.path,
      type: 'cron',
      role: {
        purpose: `Cron job: ${cron.description || cron.schedule} (${cron.platform})`,
        layer: 'infra',
        critical: false,
      },
      source: {
        detection_method: 'auto',
        config_files: [cron.source],
        confidence: 1.0,
      },
      connects_to: [],
      connected_from: [],
      status: 'active',
      tags: ['cron', cron.platform, cron.schedule],
      metadata: {
        schedule: cron.schedule,
        scheduleDescription: cron.description,
        platform: cron.platform,
      },
      timestamp,
      last_updated: timestamp,
    });

    // Try to connect cron to its API route handler
    const routeFile = resolveApiRoute(projectRoot, cron.path);
    if (routeFile) {
      connections.push({
        connection_id: generateConnectionId('cron-triggers'),
        from: {
          component_id: componentId,
          location: { file: cron.source, line: 0 },
        },
        to: {
          component_id: `FILE:${routeFile}`,
          location: { file: routeFile, line: 1 },
        },
        connection_type: 'cron-triggers',
        code_reference: {
          file: cron.source,
          symbol: cron.path,
          symbol_type: 'variable',
        },
        description: `Cron "${cron.path}" (${cron.schedule}) triggers ${routeFile}`,
        detected_from: 'cron-scanner',
        confidence: 1.0,
        timestamp,
        last_verified: timestamp,
      });
    } else if (cron.platform === 'vercel' || cron.platform === 'railway') {
      // Warn about unresolved cron routes
      warnings.push({
        type: 'low_confidence',
        message: `Cron job "${cron.path}" (${cron.schedule}) could not be resolved to a handler file`,
      });
    }
  }

  return { components, connections, warnings };
}

/**
 * Detect if project has cron jobs
 */
export function detectCrons(projectRoot: string): boolean {
  // Quick check: vercel.json with crons, railway config with cronSchedule, or cron packages
  const vercelPath = path.join(projectRoot, 'vercel.json');
  if (fs.existsSync(vercelPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
      if (Array.isArray(config.crons) && config.crons.length > 0) return true;
    } catch {
      // Ignore parse errors
    }
  }

  const railwayToml = path.join(projectRoot, 'railway.toml');
  if (fs.existsSync(railwayToml)) {
    try {
      const content = fs.readFileSync(railwayToml, 'utf-8');
      if (content.includes('cronSchedule')) return true;
    } catch {
      // Ignore
    }
  }

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['node-cron'] || allDeps.cron) return true;
    } catch {
      // Ignore
    }
  }

  return false;
}
