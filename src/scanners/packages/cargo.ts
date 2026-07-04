/**
 * Cargo Package Scanner
 * Detects Rust crates from Cargo.toml workspaces and package manifests.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ComponentType,
  generateComponentId,
  ScanResult,
  ScanWarning,
} from '../../types.js';

// =============================================================================
// CRATE SIGNATURES
// =============================================================================

interface CrateSignature {
  packageName: string;
  type: ComponentType;
  layer: 'frontend' | 'backend' | 'database' | 'queue' | 'infra' | 'external';
  purpose: string;
  critical: boolean;
}

const RUST_SIGNATURES: CrateSignature[] = [
  // Web frameworks and HTTP servers
  { packageName: 'axum', type: 'framework', layer: 'backend', purpose: 'Axum web framework', critical: true },
  { packageName: 'actix-web', type: 'framework', layer: 'backend', purpose: 'Actix Web framework', critical: true },
  { packageName: 'rocket', type: 'framework', layer: 'backend', purpose: 'Rocket web framework', critical: true },
  { packageName: 'warp', type: 'framework', layer: 'backend', purpose: 'Warp web framework', critical: true },
  { packageName: 'poem', type: 'framework', layer: 'backend', purpose: 'Poem web framework', critical: true },
  { packageName: 'tower', type: 'framework', layer: 'backend', purpose: 'Tower service middleware', critical: false },
  { packageName: 'hyper', type: 'framework', layer: 'backend', purpose: 'Hyper HTTP runtime', critical: false },

  // Async runtimes
  { packageName: 'tokio', type: 'framework', layer: 'backend', purpose: 'Tokio async runtime', critical: true },
  { packageName: 'async-std', type: 'framework', layer: 'backend', purpose: 'Async-std runtime', critical: true },

  // Database clients and ORMs
  { packageName: 'sqlx', type: 'database', layer: 'database', purpose: 'SQLx async database toolkit', critical: true },
  { packageName: 'diesel', type: 'database', layer: 'database', purpose: 'Diesel ORM', critical: true },
  { packageName: 'sea-orm', type: 'database', layer: 'database', purpose: 'SeaORM database ORM', critical: true },
  { packageName: 'rusqlite', type: 'database', layer: 'database', purpose: 'SQLite client', critical: true },
  { packageName: 'tokio-postgres', type: 'database', layer: 'database', purpose: 'PostgreSQL client', critical: true },
  { packageName: 'postgres', type: 'database', layer: 'database', purpose: 'PostgreSQL client', critical: true },
  { packageName: 'mongodb', type: 'database', layer: 'database', purpose: 'MongoDB driver', critical: true },
  { packageName: 'redis', type: 'database', layer: 'database', purpose: 'Redis client', critical: false },

  // Queue and messaging
  { packageName: 'lapin', type: 'queue', layer: 'queue', purpose: 'AMQP/RabbitMQ client', critical: true },
  { packageName: 'rdkafka', type: 'queue', layer: 'queue', purpose: 'Kafka client', critical: true },
  { packageName: 'async-nats', type: 'queue', layer: 'queue', purpose: 'NATS client', critical: true },

  // External services and infra SDKs
  { packageName: 'reqwest', type: 'cargo', layer: 'backend', purpose: 'HTTP client', critical: false },
  { packageName: 'aws-config', type: 'infra', layer: 'infra', purpose: 'AWS SDK configuration', critical: false },
  { packageName: 'aws-sdk-s3', type: 'infra', layer: 'infra', purpose: 'AWS S3 SDK', critical: false },
  { packageName: 'kube', type: 'infra', layer: 'infra', purpose: 'Kubernetes client', critical: false },
  { packageName: 'opentelemetry', type: 'infra', layer: 'infra', purpose: 'OpenTelemetry instrumentation', critical: false },
  { packageName: 'sentry', type: 'service', layer: 'external', purpose: 'Sentry error tracking', critical: false },
  { packageName: 'async-openai', type: 'service', layer: 'external', purpose: 'OpenAI Rust SDK', critical: true },
];

// =============================================================================
// CARGO.TOML PARSING
// =============================================================================

type DependencyKind = 'core' | 'dev' | 'build' | 'target' | 'workspace';
type DependencySource = 'registry' | 'path' | 'git' | 'workspace';

interface CargoDependency {
  name: string;
  crateName: string;
  version?: string;
  versionRequirement?: string;
  kind: DependencyKind;
  sourceKind: DependencySource;
  source?: string;
  configFile: string;
  optional?: boolean;
  features?: string[];
  target?: string;
  workspace?: boolean;
}

interface ParsedCargoManifest {
  dependencies: CargoDependency[];
  workspaceDependencies: Map<string, CargoDependency>;
  workspaceMembers: string[];
}

interface LockedCrate {
  version: string;
  source?: string;
}

function stripTomlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prev = line[i - 1];
    if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }

  return line;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function cleanVersion(version: string | undefined): string | undefined {
  return version?.trim().replace(/^[\^~>=<\s]+/, '') || undefined;
}

function splitInlineTable(value: string): string[] {
  const body = value.trim().replace(/^\{/, '').replace(/\}$/, '');
  const fields: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    const prev = body[i - 1];
    if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (!inSingle && !inDouble) {
      if (char === '[' || char === '{') depth++;
      if (char === ']' || char === '}') depth--;
      if (char === ',' && depth === 0) {
        fields.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim()) fields.push(current.trim());
  return fields;
}

function parseStringArray(value: string): string[] {
  const matches = value.match(/"([^"]+)"|'([^']+)'/g) ?? [];
  return matches.map(unquote);
}

function readMultilineValue(lines: string[], startIndex: number, firstValue: string): { value: string; endIndex: number } {
  let value = firstValue;
  let bracketBalance = (firstValue.match(/\[/g)?.length ?? 0) - (firstValue.match(/\]/g)?.length ?? 0);

  let i = startIndex;
  while (bracketBalance > 0 && i + 1 < lines.length) {
    i++;
    const next = stripTomlComment(lines[i]).trim();
    value += `\n${next}`;
    bracketBalance += (next.match(/\[/g)?.length ?? 0) - (next.match(/\]/g)?.length ?? 0);
  }

  return { value, endIndex: i };
}

function dependencyKindForSection(section: string): DependencyKind | null {
  if (section === 'dependencies') return 'core';
  if (section === 'dev-dependencies') return 'dev';
  if (section === 'build-dependencies') return 'build';
  if (section === 'workspace.dependencies') return 'workspace';
  if (section.startsWith('target.') && section.endsWith('.dependencies')) return 'target';
  return null;
}

function parseDependencyLine(
  line: string,
  kind: DependencyKind,
  section: string,
  configFile: string,
): CargoDependency | null {
  const match = line.match(/^("?[\w.-]+"?)\s*=\s*(.+)$/);
  if (!match) return null;

  const crateName = unquote(match[1]);
  const value = match[2].trim();
  const dependency: CargoDependency = {
    name: crateName,
    crateName,
    kind,
    sourceKind: 'registry',
    configFile,
  };

  if (value.startsWith('{')) {
    for (const field of splitInlineTable(value)) {
      const fieldMatch = field.match(/^([\w.-]+)\s*=\s*(.+)$/);
      if (!fieldMatch) continue;

      const key = fieldMatch[1];
      const raw = fieldMatch[2].trim();
      if (key === 'package') dependency.name = unquote(raw);
      if (key === 'version') {
        dependency.versionRequirement = unquote(raw);
        dependency.version = cleanVersion(unquote(raw));
      }
      if (key === 'path') {
        dependency.sourceKind = 'path';
        dependency.source = unquote(raw);
      }
      if (key === 'git') {
        dependency.sourceKind = 'git';
        dependency.source = unquote(raw);
      }
      if (key === 'workspace' && raw === 'true') {
        dependency.workspace = true;
        dependency.sourceKind = 'workspace';
      }
      if (key === 'optional') dependency.optional = raw === 'true';
      if (key === 'features') dependency.features = parseStringArray(raw);
    }
  } else {
    dependency.versionRequirement = unquote(value);
    dependency.version = cleanVersion(unquote(value));
  }

  if (kind === 'target') {
    dependency.target = section.replace(/^target\./, '').replace(/\.dependencies$/, '');
  }

  return dependency;
}

function mergeWorkspaceDependency(
  dependency: CargoDependency,
  workspaceDependencies: Map<string, CargoDependency>,
): CargoDependency {
  if (!dependency.workspace) return dependency;

  const shared = workspaceDependencies.get(dependency.crateName) ?? workspaceDependencies.get(dependency.name);
  if (!shared) return dependency;

  return {
    ...dependency,
    name: shared.name,
    version: dependency.version ?? shared.version,
    versionRequirement: dependency.versionRequirement ?? shared.versionRequirement,
    sourceKind: shared.sourceKind === 'registry' ? dependency.sourceKind : shared.sourceKind,
    source: dependency.source ?? shared.source,
    features: dependency.features && dependency.features.length > 0 ? dependency.features : shared.features,
    optional: dependency.optional ?? shared.optional,
  };
}

function parseCargoManifest(
  content: string,
  configFile: string,
  inheritedWorkspaceDependencies: Map<string, CargoDependency> = new Map(),
): ParsedCargoManifest {
  const dependencies: CargoDependency[] = [];
  const workspaceDependencies = new Map<string, CargoDependency>();
  const workspaceMembers: string[] = [];
  const lines = content.split(/\r?\n/);
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = stripTomlComment(lines[i]).trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (currentSection === 'workspace' && trimmed.startsWith('members')) {
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) continue;
      const { value, endIndex } = readMultilineValue(lines, i, trimmed.slice(equalsIndex + 1).trim());
      workspaceMembers.push(...parseStringArray(value));
      i = endIndex;
      continue;
    }

    const kind = dependencyKindForSection(currentSection);
    if (!kind) continue;

    const dependency = parseDependencyLine(trimmed, kind, currentSection, configFile);
    if (!dependency) continue;

    if (kind === 'workspace') {
      workspaceDependencies.set(dependency.crateName, dependency);
    } else {
      dependencies.push(mergeWorkspaceDependency(dependency, inheritedWorkspaceDependencies));
    }
  }

  return { dependencies, workspaceDependencies, workspaceMembers };
}

async function parseCargoLock(lockPath: string): Promise<Map<string, LockedCrate>> {
  const locked = new Map<string, LockedCrate>();
  if (!fs.existsSync(lockPath)) return locked;

  const content = await fs.promises.readFile(lockPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  let current: { name?: string; version?: string; source?: string } = {};

  const flush = () => {
    if (current.name && current.version && !locked.has(current.name)) {
      locked.set(current.name, { version: current.version, source: current.source });
    }
    current = {};
  };

  for (const line of lines) {
    const trimmed = stripTomlComment(line).trim();
    if (trimmed === '[[package]]') {
      flush();
      continue;
    }
    const match = trimmed.match(/^(name|version|source)\s*=\s*"([^"]+)"/);
    if (!match) continue;
    current[match[1] as 'name' | 'version' | 'source'] = match[2];
  }
  flush();

  return locked;
}

async function resolveCargoManifestPaths(projectRoot: string, warnings: ScanWarning[]): Promise<string[]> {
  const rootManifest = path.join(projectRoot, 'Cargo.toml');
  if (!fs.existsSync(rootManifest)) return [];

  const manifests = new Set<string>([rootManifest]);
  let rootContent = '';
  try {
    rootContent = await fs.promises.readFile(rootManifest, 'utf-8');
  } catch (error) {
    warnings.push({
      type: 'parse_error',
      message: `Failed to read Cargo.toml: ${error}`,
      file: rootManifest,
    });
    return Array.from(manifests);
  }

  const rootParsed = parseCargoManifest(rootContent, rootManifest);
  for (const memberPattern of rootParsed.workspaceMembers) {
    const normalized = memberPattern.replace(/\\/g, '/').replace(/\/$/, '');
    const manifestPattern = normalized.endsWith('Cargo.toml')
      ? normalized
      : `${normalized}/Cargo.toml`;
    try {
      const matches = await glob(manifestPattern, {
        cwd: projectRoot,
        ignore: ['target/**', '**/target/**', '.git/**'],
      });
      for (const match of matches) {
        manifests.add(path.join(projectRoot, match));
      }
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to resolve Cargo workspace member ${memberPattern}: ${error}`,
        file: rootManifest,
      });
    }
  }

  return Array.from(manifests);
}

// =============================================================================
// MAIN SCANNER
// =============================================================================

/**
 * Scan for Rust crates in Cargo.toml manifests.
 */
export async function scanCargoPackages(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  const manifestPaths = await resolveCargoManifestPaths(projectRoot, warnings);
  if (manifestPaths.length === 0) {
    return { components, connections: [], warnings };
  }

  const locked = await parseCargoLock(path.join(projectRoot, 'Cargo.lock'));
  let workspaceDependencies = new Map<string, CargoDependency>();

  const rootManifest = path.join(projectRoot, 'Cargo.toml');
  if (fs.existsSync(rootManifest)) {
    try {
      const rootContent = await fs.promises.readFile(rootManifest, 'utf-8');
      workspaceDependencies = parseCargoManifest(rootContent, rootManifest).workspaceDependencies;
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse Cargo.toml workspace dependencies: ${error}`,
        file: rootManifest,
      });
    }
  }

  for (const manifestPath of manifestPaths) {
    try {
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      const parsed = parseCargoManifest(content, manifestPath, workspaceDependencies);
      for (const dependency of parsed.dependencies) {
        const lockInfo = locked.get(dependency.name);
        components.push(createComponentFromCargoDependency(
          dependency,
          lockInfo,
          timestamp,
        ));
      }
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse ${manifestPath}: ${error}`,
        file: manifestPath,
      });
    }
  }

  const deduped = new Map<string, ArchitectureComponent>();
  for (const component of components) {
    const key = `${component.name}|${component.source.config_files[0]}`;
    if (!deduped.has(key)) deduped.set(key, component);
  }

  return {
    components: Array.from(deduped.values()),
    connections: [],
    warnings,
  };
}

/**
 * Check if Cargo/Rust is used in this project.
 */
export function detectCargo(projectRoot: string): boolean {
  return (
    fs.existsSync(path.join(projectRoot, 'Cargo.toml')) ||
    fs.existsSync(path.join(projectRoot, 'Cargo.lock'))
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function createComponentFromCargoDependency(
  dependency: CargoDependency,
  lockInfo: LockedCrate | undefined,
  timestamp: number,
): ArchitectureComponent {
  const signature = RUST_SIGNATURES.find(
    (s) => s.packageName.toLowerCase() === dependency.name.toLowerCase(),
  );

  const type: ComponentType = signature?.type || 'cargo';
  const layer = signature?.layer || 'backend';
  const purpose = signature?.purpose || 'Rust crate';
  const critical = signature?.critical ?? dependency.kind === 'core';
  const version = dependency.version ?? lockInfo?.version;

  return {
    component_id: generateComponentId(type, dependency.name),
    name: dependency.name,
    version,
    type,
    role: {
      purpose,
      layer,
      critical,
    },
    source: {
      detection_method: 'auto',
      config_files: [dependency.configFile],
      confidence: 1.0,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['cargo', dependency.kind, dependency.sourceKind, type, layer],
    repository_url: dependency.sourceKind === 'git' ? dependency.source : undefined,
    metadata: {
      package_manager: 'cargo',
      crate_name: dependency.crateName,
      dependency_kind: dependency.kind,
      source_kind: dependency.sourceKind,
      source: dependency.source,
      version_requirement: dependency.versionRequirement,
      optional: dependency.optional,
      features: dependency.features,
      target: dependency.target,
      lock_source: lockInfo?.source,
    },
    timestamp,
    last_updated: timestamp,
  };
}
