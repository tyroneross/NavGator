/**
 * Deployment Config Scanner
 * Parses vercel.json, railway.json/toml, Procfile, nixpacks.toml for deploy details
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  RuntimeIdentity,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// DEPLOY CONFIG TYPES
// =============================================================================

interface DeployConfig {
  platform: string;
  source: string;                    // Config file
  services: DeployService[];
  projectName?: string;              // Project/app name from config (e.g. vercel.json "name")
  buildConfig?: {
    framework?: string;
    buildCommand?: string;
    outputDir?: string;
  };
  constraints?: {
    timeout?: number;                // seconds
    memory?: number;                 // MB
    maxDuration?: number;            // serverless function duration
    regions?: string[];
  };
}

interface DeployService {
  name: string;
  type: 'web' | 'worker' | 'cron' | 'database' | 'other';
  startCommand?: string;
  buildCommand?: string;
}

// =============================================================================
// VERCEL CONFIG
// =============================================================================

function parseVercelConfig(projectRoot: string): { config: DeployConfig | null; warnings: ScanWarning[] } {
  const warnings: ScanWarning[] = [];
  const configPath = path.join(projectRoot, 'vercel.json');
  if (!fs.existsSync(configPath)) return { config: null, warnings };

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(content);

    const config: DeployConfig = {
      platform: 'Vercel',
      source: 'vercel.json',
      services: [{ name: 'main', type: 'web' }],
      projectName: typeof json.name === 'string' ? json.name : undefined,
      buildConfig: {
        framework: json.framework,
        buildCommand: json.buildCommand,
        outputDir: json.outputDirectory,
      },
      constraints: {},
    };

    // Function config (maxDuration, memory)
    if (json.functions) {
      for (const [pattern, fnConfig] of Object.entries(json.functions as Record<string, Record<string, unknown>>)) {
        if (fnConfig.maxDuration) {
          config.constraints!.maxDuration = fnConfig.maxDuration as number;
        }
        if (fnConfig.memory) {
          config.constraints!.memory = fnConfig.memory as number;
        }
      }
    }

    // Regions
    if (json.regions) {
      config.constraints!.regions = Array.isArray(json.regions) ? json.regions : [json.regions];
    }

    // Cron services
    if (Array.isArray(json.crons)) {
      for (const cron of json.crons) {
        config.services.push({
          name: cron.path,
          type: 'cron',
          startCommand: cron.schedule,
        });
      }
    }

    return { config, warnings };
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse vercel.json: ${error instanceof Error ? error.message : 'Unknown'}`,
      file: 'vercel.json',
    });
    return { config: null, warnings };
  }
}

// =============================================================================
// RAILWAY CONFIG
// =============================================================================

function parseRailwayConfig(projectRoot: string): { config: DeployConfig | null; warnings: ScanWarning[] } {
  const warnings: ScanWarning[] = [];

  // railway.json
  const jsonPath = path.join(projectRoot, 'railway.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const json = JSON.parse(content);

      const config: DeployConfig = {
        platform: 'Railway',
        source: 'railway.json',
        services: [],
        buildConfig: {
          buildCommand: json.build?.buildCommand,
        },
        constraints: {},
      };

      if (json.deploy) {
        config.services.push({
          name: 'main',
          type: json.deploy.cronSchedule ? 'cron' : 'web',
          startCommand: json.deploy.startCommand,
        });
      }

      // Multi-service config
      if (Array.isArray(json.services)) {
        for (const svc of json.services) {
          config.services.push({
            name: svc.name || 'unnamed',
            type: svc.cronSchedule ? 'cron' : 'web',
            startCommand: svc.startCommand,
            buildCommand: svc.buildCommand,
          });
        }
      }

      return { config, warnings };
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

      const config: DeployConfig = {
        platform: 'Railway',
        source: 'railway.toml',
        services: [],
        buildConfig: {},
        constraints: {},
      };

      // Extract build section
      const builderMatch = content.match(/\[build\][\s\S]*?builder\s*=\s*"([^"]+)"/);
      const buildCmdMatch = content.match(/buildCommand\s*=\s*"([^"]+)"/);
      config.buildConfig!.buildCommand = buildCmdMatch?.[1];
      if (builderMatch) {
        config.buildConfig!.framework = builderMatch[1];
      }

      // Extract deploy section
      const startCmdMatch = content.match(/startCommand\s*=\s*"([^"]+)"/);
      const cronMatch = content.match(/cronSchedule\s*=\s*"([^"]+)"/);

      config.services.push({
        name: 'main',
        type: cronMatch ? 'cron' : 'web',
        startCommand: startCmdMatch?.[1],
      });

      // Health check / restart policy
      const healthMatch = content.match(/healthcheckPath\s*=\s*"([^"]+)"/);
      if (healthMatch) {
        (config.constraints as Record<string, unknown>).healthcheckPath = healthMatch[1];
      }

      return { config, warnings };
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse railway.toml: ${error instanceof Error ? error.message : 'Unknown'}`,
        file: 'railway.toml',
      });
    }
  }

  return { config: null, warnings };
}

// =============================================================================
// PROCFILE
// =============================================================================

function parseProcfile(projectRoot: string): { config: DeployConfig | null; warnings: ScanWarning[] } {
  const warnings: ScanWarning[] = [];
  const procPath = path.join(projectRoot, 'Procfile');
  if (!fs.existsSync(procPath)) return { config: null, warnings };

  try {
    const content = fs.readFileSync(procPath, 'utf-8');
    const services: DeployService[] = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const name = match[1];
        const command = match[2];
        services.push({
          name,
          type: name === 'web' ? 'web' : name === 'worker' ? 'worker' : 'other',
          startCommand: command,
        });
      }
    }

    if (services.length === 0) return { config: null, warnings };

    return {
      config: {
        platform: 'Heroku/Procfile',
        source: 'Procfile',
        services,
      },
      warnings,
    };
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse Procfile: ${error instanceof Error ? error.message : 'Unknown'}`,
      file: 'Procfile',
    });
    return { config: null, warnings };
  }
}

// =============================================================================
// NIXPACKS
// =============================================================================

function parseNixpacks(projectRoot: string): { config: DeployConfig | null; warnings: ScanWarning[] } {
  const warnings: ScanWarning[] = [];
  const nixPath = path.join(projectRoot, 'nixpacks.toml');
  if (!fs.existsSync(nixPath)) return { config: null, warnings };

  try {
    const content = fs.readFileSync(nixPath, 'utf-8');

    const config: DeployConfig = {
      platform: 'Nixpacks',
      source: 'nixpacks.toml',
      services: [{ name: 'main', type: 'web' }],
      buildConfig: {},
    };

    const startMatch = content.match(/startCommand\s*=\s*"([^"]+)"/);
    const buildMatch = content.match(/buildCommand\s*=\s*"([^"]+)"/);
    const installMatch = content.match(/installCommand\s*=\s*"([^"]+)"/);

    if (startMatch) config.services[0].startCommand = startMatch[1];
    if (buildMatch) config.buildConfig!.buildCommand = buildMatch[1];

    return { config, warnings };
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse nixpacks.toml: ${error instanceof Error ? error.message : 'Unknown'}`,
      file: 'nixpacks.toml',
    });
    return { config: null, warnings };
  }
}

// =============================================================================
// SCANNER
// =============================================================================

/**
 * Scan for deployment configuration details
 * This extends the basic infra detection with parsed config details
 */
export async function scanDeployConfig(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  const parsers = [
    parseVercelConfig(projectRoot),
    parseRailwayConfig(projectRoot),
    parseProcfile(projectRoot),
    parseNixpacks(projectRoot),
  ];

  for (const { config, warnings: w } of parsers) {
    warnings.push(...w);
    if (!config) continue;

    // Heroku/Procfile: emit one component per dyno so each has its own runtime identity
    if (config.platform === 'Heroku/Procfile') {
      for (const svc of config.services) {
        const dynoName = svc.name;
        const runtime: RuntimeIdentity = {
          service_name: dynoName,
          platform: 'heroku',
          resource_type: dynoName === 'web' ? 'api' : 'worker',
        };
        const componentId = generateComponentId('infra', `heroku-${dynoName}`);
        components.push({
          component_id: componentId,
          name: `Heroku/Procfile Config (${dynoName})`,
          type: 'infra',
          role: {
            purpose: `Heroku dyno: ${dynoName} (${svc.startCommand ?? 'no command'})`,
            layer: 'infra',
            critical: true,
          },
          source: {
            detection_method: 'auto',
            config_files: [config.source],
            confidence: 1.0,
          },
          connects_to: [],
          connected_from: [],
          status: 'active',
          tags: ['deploy', 'heroku', 'procfile', dynoName],
          metadata: {
            platform: config.platform,
            services: [svc],
          },
          runtime,
          timestamp,
          last_updated: timestamp,
        });
      }
      continue;
    }

    // Build runtime identity for single-component platforms
    let runtime: RuntimeIdentity | undefined;

    if (config.platform === 'Railway') {
      const primaryService = config.services[0];
      const serviceName = primaryService?.name ?? 'main';
      const serviceType = primaryService?.type ?? 'web';
      runtime = {
        service_name: serviceName,
        platform: 'railway',
        resource_type: serviceType === 'web' ? 'api' : serviceType === 'worker' ? 'worker' : 'api',
      };
    } else if (config.platform === 'Vercel') {
      runtime = {
        service_name: config.projectName ?? 'vercel-app',
        platform: 'vercel',
        resource_type: 'api',
      };
    } else if (config.platform === 'Nixpacks') {
      runtime = {
        platform: 'nixpacks',
        resource_type: 'api',
      };
    }

    // Create a deploy-config component with rich metadata
    // (The basic platform component is already created by the infra scanner)
    const componentId = generateComponentId('infra', `${config.platform.toLowerCase()}-config`);

    components.push({
      component_id: componentId,
      name: `${config.platform} Config`,
      type: 'infra',
      role: {
        purpose: `Deploy config: ${config.services.length} service(s)${config.constraints?.maxDuration ? `, ${config.constraints.maxDuration}s timeout` : ''}${config.constraints?.regions ? `, regions: ${config.constraints.regions.join(',')}` : ''}`,
        layer: 'infra',
        critical: true,
      },
      source: {
        detection_method: 'auto',
        config_files: [config.source],
        confidence: 1.0,
      },
      connects_to: [],
      connected_from: [],
      status: 'active',
      tags: ['deploy', config.platform.toLowerCase(), 'config'],
      metadata: {
        platform: config.platform,
        services: config.services,
        buildConfig: config.buildConfig,
        constraints: config.constraints,
      },
      runtime,
      timestamp,
      last_updated: timestamp,
    });
  }

  // Create deploys-to connections from entry points to deploy components
  const connections: ArchitectureConnection[] = [];

  // Also try Dockerfile CMD if no services had start commands
  const dockerEntry = parseDockerfileCMD(projectRoot);
  if (dockerEntry) {
    // Find the Railway/Docker component to link to
    const dockerComp = components.find(c =>
      c.name.toLowerCase().includes('railway') || c.name.toLowerCase().includes('docker')
    ) || components[0]; // fallback to first deploy component
    if (dockerComp) {
      connections.push({
        connection_id: generateConnectionId('deploys-to'),
        from: {
          component_id: `FILE:${dockerEntry}`,
          location: { file: dockerEntry, line: 0 },
        },
        to: { component_id: dockerComp.component_id },
        connection_type: 'deploys-to',
        code_reference: {
          file: dockerEntry,
          symbol: 'Dockerfile CMD',
          symbol_type: 'variable',
        },
        description: `${dockerEntry} is the entry point for ${dockerComp.name}`,
        detected_from: 'deploy-scanner (Dockerfile)',
        confidence: 0.9,
        timestamp,
        last_verified: timestamp,
      });
    }
  }

  for (const comp of components) {
    const services = (comp.metadata?.services as DeployService[]) || [];
    for (const svc of services) {
      if (!svc.startCommand) continue;
      const entryFile = resolveEntryPoint(svc.startCommand, projectRoot);
      if (entryFile) {
        connections.push({
          connection_id: generateConnectionId('deploys-to'),
          from: {
            component_id: `FILE:${entryFile}`,
            location: { file: entryFile, line: 0 },
          },
          to: {
            component_id: comp.component_id,
          },
          connection_type: 'deploys-to',
          code_reference: {
            file: entryFile,
            symbol: svc.name || 'main',
            symbol_type: 'variable',
          },
          description: `${entryFile} runs as ${svc.name || 'service'} on ${comp.runtime?.platform || 'unknown'}`,
          detected_from: 'deploy-scanner',
          confidence: 0.7,
          timestamp,
          last_verified: timestamp,
        });
      }
    }
  }

  return { components, connections, warnings };
}

/**
 * Resolve a start command to its entry point file.
 * Handles: node file.js, node --import tsx file.ts, ts-node file.ts,
 * npx tsx file.ts, and Dockerfile CMD arrays.
 */
function resolveEntryPoint(command: string, projectRoot: string): string | null {
  // Strategy: find the last argument that looks like a file path
  // This handles flags like --import, --experimental-specifier-resolution, etc.
  const parts = command.split(/\s+/).filter(Boolean);

  // Skip the runner (node, ts-node, npx, tsx, etc.)
  let fileCandidate: string | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    // Skip flags and their values
    if (part.startsWith('-')) continue;
    // Skip runner names
    if (['node', 'ts-node', 'tsx', 'npx', 'bun'].includes(part)) continue;
    // This looks like a file path
    if (part.includes('/') || part.includes('.')) {
      fileCandidate = part;
      break;
    }
  }

  if (!fileCandidate) return null;

  return resolveFilePath(fileCandidate, projectRoot);
}

/**
 * Parse Dockerfile for CMD/ENTRYPOINT to find entry point files
 */
function parseDockerfileCMD(projectRoot: string): string | null {
  const dockerfilePath = path.join(projectRoot, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) return null;

  try {
    const content = fs.readFileSync(dockerfilePath, 'utf-8');

    // Match CMD ["node", "--import", "tsx", "scripts/start.ts"]
    const cmdArrayMatch = content.match(/CMD\s+\[([^\]]+)\]/);
    if (cmdArrayMatch) {
      const args = cmdArrayMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''));
      // Find the last arg that looks like a file
      for (let i = args.length - 1; i >= 0; i--) {
        if (args[i].includes('/') || args[i].endsWith('.ts') || args[i].endsWith('.js')) {
          return resolveFilePath(args[i], projectRoot);
        }
      }
    }

    // Match CMD node scripts/start.ts (shell form)
    const cmdShellMatch = content.match(/CMD\s+(.+)/);
    if (cmdShellMatch) {
      return resolveEntryPoint(cmdShellMatch[1].trim(), projectRoot);
    }

    // Match ENTRYPOINT
    const entrypointMatch = content.match(/ENTRYPOINT\s+\[([^\]]+)\]/);
    if (entrypointMatch) {
      const args = entrypointMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''));
      for (let i = args.length - 1; i >= 0; i--) {
        if (args[i].includes('/') || args[i].endsWith('.ts') || args[i].endsWith('.js')) {
          return resolveFilePath(args[i], projectRoot);
        }
      }
    }
  } catch { /* ignore read errors */ }

  return null;
}

/**
 * Resolve a file path candidate to a real file, trying dist→src mapping
 */
function resolveFilePath(filePath: string, projectRoot: string): string | null {
  const absPath = path.resolve(projectRoot, filePath);

  if (fs.existsSync(absPath)) {
    return path.relative(projectRoot, absPath);
  }

  // Try dist/ → src/ mapping
  if (filePath.startsWith('dist/')) {
    const srcEquiv = filePath.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
    const srcPath = path.resolve(projectRoot, srcEquiv);
    if (fs.existsSync(srcPath)) {
      return path.relative(projectRoot, srcPath);
    }
  }

  return null;
}
