/**
 * Infrastructure Scanner
 * Detects deployment platforms, containers, and cloud services
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  generateComponentId,
  ScanResult,
  ScanWarning,
} from '../../types.js';

// =============================================================================
// INFRASTRUCTURE SIGNATURES
// =============================================================================

interface InfraSignature {
  name: string;
  files: string[];
  envVars?: string[];
  purpose: string;
}

const INFRA_SIGNATURES: InfraSignature[] = [
  // Deployment platforms
  {
    name: 'Railway',
    files: ['railway.toml', 'railway.json', '.railway'],
    envVars: ['RAILWAY_ENVIRONMENT'],
    purpose: 'Railway deployment platform',
  },
  {
    name: 'Vercel',
    files: ['vercel.json', '.vercel'],
    envVars: ['VERCEL_ENV', 'VERCEL'],
    purpose: 'Vercel deployment platform',
  },
  {
    name: 'Netlify',
    files: ['netlify.toml', '.netlify'],
    envVars: ['NETLIFY'],
    purpose: 'Netlify deployment platform',
  },
  {
    name: 'Heroku',
    files: ['Procfile', 'app.json', 'heroku.yml'],
    envVars: ['DYNO'],
    purpose: 'Heroku deployment platform',
  },
  {
    name: 'Fly.io',
    files: ['fly.toml'],
    envVars: ['FLY_APP_NAME'],
    purpose: 'Fly.io deployment platform',
  },
  {
    name: 'Render',
    files: ['render.yaml'],
    envVars: ['RENDER'],
    purpose: 'Render deployment platform',
  },

  // Containers
  {
    name: 'Docker',
    files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'],
    purpose: 'Docker containerization',
  },
  {
    name: 'Kubernetes',
    files: ['k8s', 'kubernetes', 'helm'],
    purpose: 'Kubernetes orchestration',
  },

  // CI/CD
  {
    name: 'GitHub Actions',
    files: ['.github/workflows'],
    purpose: 'GitHub Actions CI/CD',
  },
  {
    name: 'GitLab CI',
    files: ['.gitlab-ci.yml'],
    purpose: 'GitLab CI/CD',
  },
  {
    name: 'CircleCI',
    files: ['.circleci/config.yml'],
    purpose: 'CircleCI CI/CD',
  },

  // Serverless
  {
    name: 'Serverless Framework',
    files: ['serverless.yml', 'serverless.yaml'],
    purpose: 'Serverless Framework',
  },
  {
    name: 'AWS SAM',
    files: ['sam.yaml', 'template.yaml'],
    purpose: 'AWS Serverless Application Model',
  },
  {
    name: 'AWS CDK',
    files: ['cdk.json'],
    purpose: 'AWS Cloud Development Kit',
  },
  {
    name: 'Terraform',
    files: ['main.tf', 'terraform.tf', '.terraform'],
    purpose: 'Terraform infrastructure as code',
  },
  {
    name: 'Pulumi',
    files: ['Pulumi.yaml'],
    purpose: 'Pulumi infrastructure as code',
  },

  // Apple / Xcode
  {
    name: 'Xcode',
    files: ['Package.swift', '*.xcodeproj', '*.xcworkspace'],
    purpose: 'Xcode/Swift project',
  },
  {
    name: 'Fastlane',
    files: ['Fastfile', 'fastlane/Fastfile'],
    purpose: 'Fastlane build automation',
  },
  {
    name: 'Xcode Cloud',
    files: ['ci_scripts', '.xcode-version'],
    purpose: 'Xcode Cloud CI/CD',
  },
];

// =============================================================================
// SCANNING
// =============================================================================

/**
 * Scan for infrastructure components
 */
export async function scanInfrastructure(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  for (const signature of INFRA_SIGNATURES) {
    const detected = await detectInfra(projectRoot, signature);
    if (detected) {
      const component = createInfraComponent(
        signature,
        detected.configFiles,
        timestamp
      );
      components.push(component);
    }
  }

  return { components, connections: [], warnings };
}

/**
 * Check if infrastructure is present
 */
async function detectInfra(
  projectRoot: string,
  signature: InfraSignature
): Promise<{ configFiles: string[] } | null> {
  const foundFiles: string[] = [];

  for (const file of signature.files) {
    if (file.startsWith('*')) {
      // Suffix match: e.g. "*.xcodeproj" — find entries ending with suffix
      const suffix = file.slice(1);
      try {
        const entries = fs.readdirSync(projectRoot);
        const matching = entries.filter(e => e.endsWith(suffix));
        foundFiles.push(...matching);
      } catch {
        // Skip if directory can't be read
      }
    } else {
      const filePath = path.join(projectRoot, file);
      // Check if file or directory exists
      if (fs.existsSync(filePath)) {
        foundFiles.push(file);
      }
    }
  }

  if (foundFiles.length > 0) {
    return { configFiles: foundFiles };
  }

  // Check environment variables as fallback
  if (signature.envVars) {
    for (const envVar of signature.envVars) {
      if (process.env[envVar]) {
        return { configFiles: [`ENV:${envVar}`] };
      }
    }
  }

  return null;
}

/**
 * Create an infrastructure component
 */
function createInfraComponent(
  signature: InfraSignature,
  configFiles: string[],
  timestamp: number
): ArchitectureComponent {
  return {
    component_id: generateComponentId('infra', signature.name.toLowerCase()),
    name: signature.name,
    type: 'infra',
    role: {
      purpose: signature.purpose,
      layer: 'infra',
      critical: true,
    },
    source: {
      detection_method: 'auto',
      config_files: configFiles,
      confidence: 1.0,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['infra', signature.name.toLowerCase()],
    timestamp,
    last_updated: timestamp,
  };
}

/**
 * Parse Docker Compose to find services
 */
export async function parseDockerCompose(
  projectRoot: string
): Promise<{ services: string[] }> {
  const services: string[] = [];
  const composeFiles = ['docker-compose.yml', 'docker-compose.yaml'];

  for (const file of composeFiles) {
    const filePath = path.join(projectRoot, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');

      // Basic YAML parsing for services
      const servicesMatch = content.match(/services:\s*\n([\s\S]*?)(?=\n\w|$)/);
      if (servicesMatch) {
        const serviceNames = servicesMatch[1].match(/^\s{2}(\w+):/gm);
        if (serviceNames) {
          for (const match of serviceNames) {
            const name = match.trim().replace(':', '').trim();
            services.push(name);
          }
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  return { services };
}

/**
 * Parse Railway config for service info
 */
export async function parseRailwayConfig(
  projectRoot: string
): Promise<{ build?: string; start?: string } | null> {
  const configPath = path.join(projectRoot, 'railway.toml');
  if (!fs.existsSync(configPath)) return null;

  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');

    const buildMatch = content.match(/\[build\][\s\S]*?builder\s*=\s*"([^"]+)"/);
    const startMatch = content.match(/\[deploy\][\s\S]*?startCommand\s*=\s*"([^"]+)"/);

    return {
      build: buildMatch?.[1],
      start: startMatch?.[1],
    };
  } catch {
    return null;
  }
}

/**
 * Check for any infrastructure in the project
 */
export function hasInfrastructure(projectRoot: string): boolean {
  for (const signature of INFRA_SIGNATURES) {
    for (const file of signature.files) {
      if (fs.existsSync(path.join(projectRoot, file))) {
        return true;
      }
    }
  }
  return false;
}
