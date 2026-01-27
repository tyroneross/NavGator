/**
 * Python Package Scanner
 * Detects packages from requirements.txt, pyproject.toml, setup.py
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ComponentType,
  generateComponentId,
  ScanResult,
  ScanWarning,
} from '../../types.js';

// =============================================================================
// FRAMEWORK DETECTION
// =============================================================================

interface FrameworkSignature {
  packageName: string;
  type: ComponentType;
  layer: 'frontend' | 'backend' | 'database' | 'queue' | 'infra' | 'external';
  purpose: string;
  critical: boolean;
}

const PYTHON_SIGNATURES: FrameworkSignature[] = [
  // Web frameworks
  { packageName: 'django', type: 'framework', layer: 'backend', purpose: 'Django web framework', critical: true },
  { packageName: 'flask', type: 'framework', layer: 'backend', purpose: 'Flask web framework', critical: true },
  { packageName: 'fastapi', type: 'framework', layer: 'backend', purpose: 'FastAPI framework', critical: true },
  { packageName: 'starlette', type: 'framework', layer: 'backend', purpose: 'Starlette ASGI framework', critical: true },
  { packageName: 'tornado', type: 'framework', layer: 'backend', purpose: 'Tornado async framework', critical: true },

  // Database
  { packageName: 'sqlalchemy', type: 'database', layer: 'database', purpose: 'SQLAlchemy ORM', critical: true },
  { packageName: 'psycopg2', type: 'database', layer: 'database', purpose: 'PostgreSQL adapter', critical: true },
  { packageName: 'psycopg2-binary', type: 'database', layer: 'database', purpose: 'PostgreSQL adapter', critical: true },
  { packageName: 'pymongo', type: 'database', layer: 'database', purpose: 'MongoDB driver', critical: true },
  { packageName: 'redis', type: 'database', layer: 'database', purpose: 'Redis client', critical: false },
  { packageName: 'prisma', type: 'database', layer: 'database', purpose: 'Prisma Python client', critical: true },
  { packageName: 'supabase', type: 'service', layer: 'database', purpose: 'Supabase client', critical: true },

  // Queue systems
  { packageName: 'celery', type: 'queue', layer: 'queue', purpose: 'Celery task queue', critical: true },
  { packageName: 'rq', type: 'queue', layer: 'queue', purpose: 'Redis Queue', critical: true },
  { packageName: 'dramatiq', type: 'queue', layer: 'queue', purpose: 'Dramatiq task queue', critical: true },

  // AI/ML
  { packageName: 'anthropic', type: 'service', layer: 'external', purpose: 'Claude AI SDK', critical: true },
  { packageName: 'openai', type: 'service', layer: 'external', purpose: 'OpenAI SDK', critical: true },
  { packageName: 'langchain', type: 'service', layer: 'external', purpose: 'LangChain framework', critical: true },
  { packageName: 'transformers', type: 'npm', layer: 'backend', purpose: 'Hugging Face Transformers', critical: false },

  // External services
  { packageName: 'stripe', type: 'service', layer: 'external', purpose: 'Stripe payments', critical: true },
  { packageName: 'twilio', type: 'service', layer: 'external', purpose: 'Twilio SMS/Voice', critical: false },
  { packageName: 'boto3', type: 'infra', layer: 'infra', purpose: 'AWS SDK', critical: false },
  { packageName: 'google-cloud-storage', type: 'infra', layer: 'infra', purpose: 'Google Cloud Storage', critical: false },
];

// =============================================================================
// REQUIREMENTS.TXT PARSING
// =============================================================================

/**
 * Scan for Python packages in a project
 */
export async function scanPipPackages(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Scan requirements.txt
  const requirementsPath = path.join(projectRoot, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
    const result = await parseRequirementsTxt(requirementsPath, timestamp);
    components.push(...result.components);
    warnings.push(...result.warnings);
  }

  // Scan pyproject.toml
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const result = await parsePyprojectToml(pyprojectPath, timestamp);
    components.push(...result.components);
    warnings.push(...result.warnings);
  }

  // Deduplicate by name (prefer pyproject.toml version if both exist)
  const seen = new Map<string, ArchitectureComponent>();
  for (const component of components) {
    if (!seen.has(component.name)) {
      seen.set(component.name, component);
    }
  }

  return {
    components: Array.from(seen.values()),
    connections: [],
    warnings,
  };
}

/**
 * Parse requirements.txt file
 */
async function parseRequirementsTxt(
  filePath: string,
  timestamp: number
): Promise<{ components: ArchitectureComponent[]; warnings: ScanWarning[] }> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Skip -r includes and other flags
      if (trimmed.startsWith('-')) continue;

      // Parse package name and version
      const parsed = parseRequirementLine(trimmed);
      if (parsed) {
        const component = createComponentFromPackage(
          parsed.name,
          parsed.version,
          filePath,
          timestamp
        );
        components.push(component);
      }
    }
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse requirements.txt: ${error}`,
      file: filePath,
    });
  }

  return { components, warnings };
}

/**
 * Parse a single requirement line
 */
function parseRequirementLine(
  line: string
): { name: string; version?: string } | null {
  // Handle various formats:
  // package==1.0.0
  // package>=1.0.0
  // package~=1.0.0
  // package[extra]==1.0.0
  // package @ https://...

  // Remove extras like [extra1,extra2]
  const withoutExtras = line.replace(/\[.*?\]/, '');

  // Split by version specifier
  const match = withoutExtras.match(/^([a-zA-Z0-9_-]+)\s*([@<>=!~]+.*)?$/);
  if (!match) return null;

  const name = match[1].toLowerCase();
  let version: string | undefined;

  if (match[2]) {
    // Extract version number from specifier
    const versionMatch = match[2].match(/[<>=!~]+\s*(\d+[\d.]*\d*)/);
    if (versionMatch) {
      version = versionMatch[1];
    }
  }

  return { name, version };
}

/**
 * Parse pyproject.toml file (basic parsing)
 */
async function parsePyprojectToml(
  filePath: string,
  timestamp: number
): Promise<{ components: ArchitectureComponent[]; warnings: ScanWarning[] }> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // Basic TOML parsing for dependencies
    // Look for [project.dependencies] or [tool.poetry.dependencies]
    const dependencyMatches = content.match(
      /\[(?:project\.dependencies|tool\.poetry\.dependencies)\]([\s\S]*?)(?=\[|$)/
    );

    if (dependencyMatches) {
      const section = dependencyMatches[1];
      const lines = section.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Parse "package = version" or "package = {version = ...}"
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']?([^"'\s}]+)/);
        if (match) {
          const name = match[1].toLowerCase();
          const version = match[2].replace(/[^0-9.]/g, '');

          const component = createComponentFromPackage(
            name,
            version || undefined,
            filePath,
            timestamp
          );
          components.push(component);
        }
      }
    }

    // Also check for dependencies array format
    const arrayMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (arrayMatch) {
      const deps = arrayMatch[1].match(/"([^"]+)"/g) || [];
      for (const dep of deps) {
        const parsed = parseRequirementLine(dep.replace(/"/g, ''));
        if (parsed) {
          const component = createComponentFromPackage(
            parsed.name,
            parsed.version,
            filePath,
            timestamp
          );
          components.push(component);
        }
      }
    }
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse pyproject.toml: ${error}`,
      file: filePath,
    });
  }

  return { components, warnings };
}

/**
 * Create a component from a Python package
 */
function createComponentFromPackage(
  name: string,
  version: string | undefined,
  configFile: string,
  timestamp: number
): ArchitectureComponent {
  // Check if this matches a known framework/service
  const signature = PYTHON_SIGNATURES.find(
    (s) => s.packageName.toLowerCase() === name.toLowerCase()
  );

  const type: ComponentType = signature?.type || 'pip';
  const layer = signature?.layer || 'backend';
  const purpose = signature?.purpose || `Python package`;
  const critical = signature?.critical ?? true;

  return {
    component_id: generateComponentId('pip', name),
    name,
    version,
    type,
    role: {
      purpose,
      layer,
      critical,
    },
    source: {
      detection_method: 'auto',
      config_files: [configFile],
      confidence: 1.0,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['pip', type, layer],
    timestamp,
    last_updated: timestamp,
  };
}

/**
 * Check if pip/Python is used in this project
 */
export function detectPip(projectRoot: string): boolean {
  return (
    fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
    fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
    fs.existsSync(path.join(projectRoot, 'setup.py')) ||
    fs.existsSync(path.join(projectRoot, 'Pipfile'))
  );
}
