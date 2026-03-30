/**
 * Environment Variable Scanner
 * Discovers env vars from .env files and process.env references in source code
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// ENV FILE PARSING
// =============================================================================

interface EnvVarDefinition {
  name: string;
  definedIn: string[];       // Which .env files define it
  referencedIn: string[];    // Which source files use it
  hasDefault: boolean;       // Has a non-empty value in .env
}

/**
 * Find all .env* files in the project root
 */
function findEnvFiles(projectRoot: string): string[] {
  const candidates: string[] = [];
  try {
    const entries = fs.readdirSync(projectRoot);
    for (const entry of entries) {
      if (entry === '.env' || entry.startsWith('.env.')) {
        // Skip .env.local values for security, but still track the variable names
        const fullPath = path.join(projectRoot, entry);
        if (fs.statSync(fullPath).isFile()) {
          candidates.push(entry);
        }
      }
    }
  } catch {
    // Skip if directory unreadable
  }
  return candidates;
}

/**
 * Parse env file for variable names (never captures values)
 */
function parseEnvFile(content: string): string[] {
  const vars: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match KEY=value or KEY="value" or KEY='value' or export KEY=value
    const match = trimmed.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (match) {
      vars.push(match[1]);
    }
  }

  return vars;
}

/**
 * Scan source files for process.env.X references
 */
async function findEnvReferences(
  projectRoot: string
): Promise<Map<string, string[]>> {
  const envRefs = new Map<string, string[]>(); // envVar -> [file1, file2, ...]

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs}', {
    cwd: projectRoot,
    ignore: [
      '**/node_modules/**', '**/dist/**', '**/build/**',
      '**/.next/**', '**/coverage/**', '**/.git/**',
    ],
  });

  for (const file of sourceFiles) {
    try {
      const content = await fs.promises.readFile(
        path.join(projectRoot, file),
        'utf-8'
      );

      // Match process.env.VAR_NAME and process.env['VAR_NAME'] and process.env["VAR_NAME"]
      const patterns = [
        /process\.env\.([A-Z_][A-Z0-9_]*)/g,
        /process\.env\['([A-Z_][A-Z0-9_]*)'\]/g,
        /process\.env\["([A-Z_][A-Z0-9_]*)"\]/g,
        // Also match import.meta.env.VITE_* (Vite pattern)
        /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          const varName = match[1];
          const refs = envRefs.get(varName) || [];
          if (!refs.includes(file)) {
            refs.push(file);
          }
          envRefs.set(varName, refs);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return envRefs;
}

// =============================================================================
// CATEGORIZATION
// =============================================================================

type EnvCategory = 'database' | 'auth' | 'api-key' | 'service' | 'app-config' | 'infra' | 'other';

export function categorizeEnvVar(name: string): EnvCategory {
  const n = name.toUpperCase();

  if (n.includes('DATABASE') || n.includes('DB_') || n.includes('POSTGRES') ||
      n.includes('MYSQL') || n.includes('MONGO') || n.includes('REDIS') ||
      n.includes('SUPABASE')) {
    return 'database';
  }
  if (n.includes('AUTH') || n.includes('JWT') || n.includes('SECRET') ||
      n.includes('SESSION') || n.includes('NEXTAUTH') || n.includes('CLERK')) {
    return 'auth';
  }
  if ((n.includes('API_KEY') && !n.includes('VERCEL')) ||
      (n.includes('APIKEY') && !n.includes('VERCEL')) ||
      (n.includes('_KEY') && !n.includes('VERCEL')) ||
      (n.includes('TOKEN') && !n.includes('VERCEL'))) {
    return 'api-key';
  }
  if (n.includes('STRIPE') || n.includes('OPENAI') || n.includes('ANTHROPIC') ||
      n.includes('SENDGRID') || n.includes('TWILIO') || n.includes('AWS_')) {
    return 'service';
  }
  if (n.includes('VERCEL') || n.includes('RAILWAY') || n.includes('PORT') ||
      n.includes('HOST') || n.includes('NODE_ENV') || n.includes('NEXT_PUBLIC')) {
    return 'infra';
  }
  if (n.includes('APP_') || n.includes('SITE_') || n.includes('BASE_URL') ||
      n.includes('PUBLIC_URL')) {
    return 'app-config';
  }
  return 'other';
}

// =============================================================================
// SCANNER
// =============================================================================

/**
 * Scan for environment variables across .env files and source code
 */
export async function scanEnvVars(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Phase 1: Parse .env files
  const envFiles = findEnvFiles(projectRoot);
  const definedVars = new Map<string, string[]>(); // varName -> [envFile1, envFile2]

  for (const envFile of envFiles) {
    try {
      const content = await fs.promises.readFile(
        path.join(projectRoot, envFile),
        'utf-8'
      );
      const vars = parseEnvFile(content);
      for (const v of vars) {
        const files = definedVars.get(v) || [];
        if (!files.includes(envFile)) files.push(envFile);
        definedVars.set(v, files);
      }
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse ${envFile}: ${error instanceof Error ? error.message : 'Unknown'}`,
        file: envFile,
      });
    }
  }

  // Phase 2: Scan source files for process.env references
  const envRefs = await findEnvReferences(projectRoot);

  // Phase 3: Merge defined + referenced vars
  const allVarNames = new Set([...definedVars.keys(), ...envRefs.keys()]);

  if (allVarNames.size === 0) {
    return { components, connections, warnings };
  }

  // Categorize and create components by category group
  const byCategory = new Map<EnvCategory, EnvVarDefinition[]>();

  for (const varName of allVarNames) {
    const category = categorizeEnvVar(varName);
    const group = byCategory.get(category) || [];
    group.push({
      name: varName,
      definedIn: definedVars.get(varName) || [],
      referencedIn: envRefs.get(varName) || [],
      hasDefault: (definedVars.get(varName) || []).length > 0,
    });
    byCategory.set(category, group);
  }

  // Create a component per env var (grouped metadata by category)
  const envComponentMap = new Map<string, string>(); // varName -> component_id

  for (const [category, vars] of byCategory) {
    for (const envVar of vars) {
      const componentId = generateComponentId('config', envVar.name);
      envComponentMap.set(envVar.name, componentId);

      const isDefined = envVar.definedIn.length > 0;
      const isReferenced = envVar.referencedIn.length > 0;
      const status = isDefined && isReferenced ? 'active'
        : isDefined && !isReferenced ? 'unused'
        : 'active'; // referenced but not in .env = runtime-injected

      components.push({
        component_id: componentId,
        name: envVar.name,
        type: 'config',
        role: {
          purpose: `Environment variable (${category}) — ${isReferenced ? `used in ${envVar.referencedIn.length} file(s)` : 'defined but unused'}`,
          layer: 'infra',
          critical: category === 'database' || category === 'auth',
        },
        source: {
          detection_method: 'auto',
          config_files: envVar.definedIn.length > 0 ? envVar.definedIn : ['runtime-injected'],
          confidence: isDefined ? 1.0 : 0.8,
        },
        connects_to: [],
        connected_from: [],
        status,
        tags: ['env', category, ...(envVar.definedIn.length === 0 ? ['runtime-only'] : [])],
        metadata: {
          category,
          definedIn: envVar.definedIn,
          referencedIn: envVar.referencedIn,
          hasDefault: envVar.hasDefault,
        },
        timestamp,
        last_updated: timestamp,
      });
    }
  }

  // Phase 4: Create connections from source files to env vars
  for (const [varName, files] of envRefs) {
    const envCompId = envComponentMap.get(varName);
    if (!envCompId) continue;

    for (const file of files) {
      const connectionId = generateConnectionId('env-dependency');
      connections.push({
        connection_id: connectionId,
        from: {
          component_id: `FILE:${file}`,
          location: { file, line: 0 },
        },
        to: {
          component_id: envCompId,
        },
        connection_type: 'env-dependency',
        code_reference: {
          file,
          symbol: `process.env.${varName}`,
          symbol_type: 'variable',
        },
        description: `${file} depends on env var ${varName}`,
        detected_from: 'env-scanner',
        confidence: 1.0,
        timestamp,
        last_verified: timestamp,
      });
    }
  }

  // Warn about referenced but undefined vars (potential missing config)
  for (const [varName] of envRefs) {
    if (!definedVars.has(varName)) {
      // Skip common runtime-injected vars
      const skipPatterns = ['NODE_ENV', 'PORT', 'VERCEL', 'RAILWAY', 'CI', 'HOME', 'PATH'];
      if (skipPatterns.some(p => varName.startsWith(p))) continue;

      warnings.push({
        type: 'missing_file',
        message: `Environment variable ${varName} is referenced in source but not defined in any .env file (may be runtime-injected)`,
      });
    }
  }

  return { components, connections, warnings };
}

/**
 * Detect if project has env files
 */
export function detectEnvFiles(projectRoot: string): boolean {
  return findEnvFiles(projectRoot).length > 0;
}
