/**
 * NPM Package Scanner
 * Detects packages from package.json, yarn.lock, pnpm-lock.yaml
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

const FRAMEWORK_SIGNATURES: FrameworkSignature[] = [
  // Frontend frameworks
  { packageName: 'next', type: 'framework', layer: 'frontend', purpose: 'React framework with SSR', critical: true },
  { packageName: 'react', type: 'npm', layer: 'frontend', purpose: 'UI library', critical: true },
  { packageName: 'vue', type: 'framework', layer: 'frontend', purpose: 'Vue.js framework', critical: true },
  { packageName: 'svelte', type: 'framework', layer: 'frontend', purpose: 'Svelte framework', critical: true },
  { packageName: '@angular/core', type: 'framework', layer: 'frontend', purpose: 'Angular framework', critical: true },

  // Backend frameworks
  { packageName: 'express', type: 'framework', layer: 'backend', purpose: 'Node.js web framework', critical: true },
  { packageName: 'fastify', type: 'framework', layer: 'backend', purpose: 'Fast Node.js framework', critical: true },
  { packageName: 'hono', type: 'framework', layer: 'backend', purpose: 'Lightweight web framework', critical: true },
  { packageName: 'koa', type: 'framework', layer: 'backend', purpose: 'Koa web framework', critical: true },
  { packageName: 'nestjs', type: 'framework', layer: 'backend', purpose: 'NestJS framework', critical: true },
  { packageName: '@nestjs/core', type: 'framework', layer: 'backend', purpose: 'NestJS framework', critical: true },

  // Database clients
  { packageName: 'prisma', type: 'database', layer: 'database', purpose: 'Prisma ORM', critical: true },
  { packageName: '@prisma/client', type: 'database', layer: 'database', purpose: 'Prisma client', critical: true },
  { packageName: 'drizzle-orm', type: 'database', layer: 'database', purpose: 'Drizzle ORM', critical: true },
  { packageName: 'mongoose', type: 'database', layer: 'database', purpose: 'MongoDB ODM', critical: true },
  { packageName: 'pg', type: 'database', layer: 'database', purpose: 'PostgreSQL client', critical: true },
  { packageName: 'mysql2', type: 'database', layer: 'database', purpose: 'MySQL client', critical: true },
  { packageName: '@supabase/supabase-js', type: 'service', layer: 'database', purpose: 'Supabase client', critical: true },
  { packageName: 'redis', type: 'database', layer: 'database', purpose: 'Redis client', critical: false },
  { packageName: 'ioredis', type: 'database', layer: 'database', purpose: 'Redis client', critical: false },

  // Queue systems
  { packageName: 'bullmq', type: 'queue', layer: 'queue', purpose: 'BullMQ job queue', critical: true },
  { packageName: 'bull', type: 'queue', layer: 'queue', purpose: 'Bull job queue', critical: true },
  { packageName: '@aws-sdk/client-sqs', type: 'queue', layer: 'queue', purpose: 'AWS SQS client', critical: true },

  // External services
  { packageName: 'stripe', type: 'service', layer: 'external', purpose: 'Stripe payments', critical: true },
  { packageName: '@anthropic-ai/sdk', type: 'service', layer: 'external', purpose: 'Claude AI SDK', critical: true },
  { packageName: 'openai', type: 'service', layer: 'external', purpose: 'OpenAI SDK', critical: true },
  { packageName: 'twilio', type: 'service', layer: 'external', purpose: 'Twilio SMS/Voice', critical: false },
  { packageName: '@sendgrid/mail', type: 'service', layer: 'external', purpose: 'SendGrid email', critical: false },
  { packageName: 'nodemailer', type: 'service', layer: 'external', purpose: 'Email sending', critical: false },

  // Infrastructure
  { packageName: '@aws-sdk/client-s3', type: 'infra', layer: 'infra', purpose: 'AWS S3 storage', critical: false },
  { packageName: '@vercel/kv', type: 'infra', layer: 'infra', purpose: 'Vercel KV storage', critical: false },
  { packageName: '@vercel/blob', type: 'infra', layer: 'infra', purpose: 'Vercel Blob storage', critical: false },
];

// =============================================================================
// PACKAGE.JSON PARSING
// =============================================================================

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

// =============================================================================
// WORKSPACE / MONOREPO DETECTION
// =============================================================================

/**
 * Detect workspace package paths from package.json workspaces field
 * or pnpm-workspace.yaml
 */
async function resolveWorkspacePackages(projectRoot: string): Promise<string[]> {
  const packagePaths: string[] = [];

  // 1. Check pnpm-workspace.yaml
  const pnpmWorkspacePath = path.join(projectRoot, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const content = await fs.promises.readFile(pnpmWorkspacePath, 'utf-8');
      // Parse simple YAML: extract lines under "packages:" that start with "- "
      const lines = content.split('\n');
      let inPackages = false;
      for (const line of lines) {
        if (/^packages:\s*$/.test(line.trim())) {
          inPackages = true;
          continue;
        }
        if (inPackages && /^\s+-\s+/.test(line)) {
          const pattern = line.replace(/^\s+-\s+/, '').replace(/['"]/g, '').trim();
          packagePaths.push(pattern);
        } else if (inPackages && /^\S/.test(line)) {
          break; // Next top-level key
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 2. Check package.json workspaces field
  if (packagePaths.length === 0) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content) as PackageJson;
        if (pkg.workspaces) {
          const patterns = Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : pkg.workspaces.packages || [];
          packagePaths.push(...patterns);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  if (packagePaths.length === 0) return [];

  // 3. Resolve glob patterns to actual directories with package.json
  const resolved: string[] = [];
  for (const pattern of packagePaths) {
    // Convert workspace glob to directory glob (e.g., "packages/*" → find dirs)
    const globPattern = pattern.endsWith('/*') || pattern.endsWith('/**')
      ? pattern
      : `${pattern}/*`;

    try {
      const { glob: globFn } = await import('glob');
      const matches = await globFn(globPattern, {
        cwd: projectRoot,
        ignore: ['**/node_modules/**'],
      });
      for (const match of matches) {
        const pkgJson = path.join(projectRoot, match, 'package.json');
        if (fs.existsSync(pkgJson)) {
          resolved.push(path.join(projectRoot, match));
        }
      }
    } catch {
      // If glob fails, try direct path
      const directPath = path.join(projectRoot, pattern.replace(/\/\*+$/, ''));
      if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
        const entries = fs.readdirSync(directPath);
        for (const entry of entries) {
          const subDir = path.join(directPath, entry);
          if (fs.existsSync(path.join(subDir, 'package.json'))) {
            resolved.push(subDir);
          }
        }
      }
    }
  }

  return resolved;
}

// =============================================================================
// PACKAGE.JSON SCANNING
// =============================================================================

/**
 * Scan a single package.json and return components
 */
async function scanSinglePackageJson(
  packageJsonPath: string,
  warnings: ScanWarning[]
): Promise<ArchitectureComponent[]> {
  const components: ArchitectureComponent[] = [];

  let packageJson: PackageJson;
  try {
    const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse ${packageJsonPath}: ${error}`,
      file: packageJsonPath,
    });
    return components;
  }

  const timestamp = Date.now();

  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      components.push(
        createComponentFromPackage(name, version, 'core', packageJsonPath, timestamp)
      );
    }
  }

  if (packageJson.devDependencies) {
    for (const [name, version] of Object.entries(packageJson.devDependencies)) {
      components.push(
        createComponentFromPackage(name, version, 'dev', packageJsonPath, timestamp)
      );
    }
  }

  return components;
}

/**
 * Scan for npm packages in a project (including monorepo workspaces)
 */
export async function scanNpmPackages(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];

  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return { components, connections: [], warnings };
  }

  // Scan root package.json
  const rootComponents = await scanSinglePackageJson(packageJsonPath, warnings);
  components.push(...rootComponents);

  // Scan workspace sub-packages (monorepo support)
  const workspacePackages = await resolveWorkspacePackages(projectRoot);
  if (workspacePackages.length > 0) {
    for (const pkgDir of workspacePackages) {
      const subPkgPath = path.join(pkgDir, 'package.json');
      const subComponents = await scanSinglePackageJson(subPkgPath, warnings);
      components.push(...subComponents);
    }
  }

  return { components, connections: [], warnings };
}

/**
 * Create a component from a package entry
 */
function createComponentFromPackage(
  name: string,
  version: string,
  category: 'core' | 'dev',
  configFile: string,
  timestamp: number
): ArchitectureComponent {
  // Check if this matches a known framework/service
  const signature = FRAMEWORK_SIGNATURES.find((s) => s.packageName === name);

  const type: ComponentType = signature?.type || 'npm';
  const layer = signature?.layer || (category === 'dev' ? 'backend' : 'backend');
  const purpose = signature?.purpose || `npm package`;
  const critical = signature?.critical ?? (category === 'core');

  // Clean version string (remove ^, ~, etc.)
  const cleanVersion = version.replace(/^[\^~>=<]+/, '');

  return {
    component_id: generateComponentId(type, name),
    name,
    version: cleanVersion,
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
    tags: [category, type, layer],
    timestamp,
    last_updated: timestamp,
  };
}

/**
 * Check if npm is used in this project
 */
export function detectNpm(projectRoot: string): boolean {
  return (
    fs.existsSync(path.join(projectRoot, 'package.json')) ||
    fs.existsSync(path.join(projectRoot, 'package-lock.json')) ||
    fs.existsSync(path.join(projectRoot, 'yarn.lock')) ||
    fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))
  );
}

/**
 * Get the package manager type
 */
export function detectPackageManager(
  projectRoot: string
): 'npm' | 'yarn' | 'pnpm' | null {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(projectRoot, 'package.json'))) return 'npm';
  return null;
}
