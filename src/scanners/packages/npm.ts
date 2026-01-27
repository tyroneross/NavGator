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
}

/**
 * Scan for npm packages in a project
 */
export async function scanNpmPackages(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];

  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return { components, connections: [], warnings };
  }

  let packageJson: PackageJson;
  try {
    const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to parse package.json: ${error}`,
      file: packageJsonPath,
    });
    return { components, connections: [], warnings };
  }

  const timestamp = Date.now();

  // Process dependencies
  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      const component = createComponentFromPackage(
        name,
        version,
        'core',
        packageJsonPath,
        timestamp
      );
      components.push(component);
    }
  }

  // Process devDependencies
  if (packageJson.devDependencies) {
    for (const [name, version] of Object.entries(packageJson.devDependencies)) {
      const component = createComponentFromPackage(
        name,
        version,
        'dev',
        packageJsonPath,
        timestamp
      );
      components.push(component);
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
