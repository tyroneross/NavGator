/**
 * Deployment Config Scanner
 * Parses vercel.json, railway.json/toml, Procfile, nixpacks.toml for deploy details
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ScanResult,
  ScanWarning,
  generateComponentId,
} from '../../types.js';

// =============================================================================
// DEPLOY CONFIG TYPES
// =============================================================================

interface DeployConfig {
  platform: string;
  source: string;                    // Config file
  services: DeployService[];
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
      timestamp,
      last_updated: timestamp,
    });
  }

  return { components, connections: [], warnings };
}
