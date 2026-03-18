/**
 * NavGator Import Scanner
 * Fast regex-based file-level import graph builder.
 * Extracts import/require/export-from statements and resolves to actual file paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// Extensions to try when resolving bare imports (order matters)
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const INDEX_FILES = RESOLVE_EXTENSIONS.map(ext => `index${ext}`);

// Regex patterns — only match relative imports (starts with . or /)
const ES_IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"])/g;
const ES_REEXPORT_RE = /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;

// Map .js/.jsx extensions to their TypeScript equivalents
// (TS convention: `import './foo.js'` resolves to `./foo.ts`)
const JS_TO_TS: [string, string][] = [
  ['.js', '.ts'],
  ['.js', '.tsx'],
  ['.jsx', '.tsx'],
  ['.jsx', '.ts'],
];

/**
 * Resolve a relative import specifier to an actual file path.
 * Uses a known-files set for fast validation instead of fs.existsSync.
 */
function resolveImport(
  specifier: string,
  importerDir: string,
  projectRoot: string,
  knownFiles: Set<string>
): string | null {
  const absTarget = path.resolve(importerDir, specifier);
  const relTarget = path.relative(projectRoot, absTarget);

  // Don't resolve outside project
  if (relTarget.startsWith('..')) return null;

  // Try exact path
  if (knownFiles.has(relTarget)) return relTarget;

  // Try .js → .ts mapping (TS convention: import './foo.js' → ./foo.ts)
  for (const [jsExt, tsExt] of JS_TO_TS) {
    if (relTarget.endsWith(jsExt)) {
      const candidate = relTarget.slice(0, -jsExt.length) + tsExt;
      if (knownFiles.has(candidate)) return candidate;
    }
  }

  // Try adding extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = relTarget + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  // Try as directory with index file
  for (const indexFile of INDEX_FILES) {
    const candidate = path.join(relTarget, indexFile);
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Extract all relative import specifiers from file content.
 * Only captures ./  and ../  imports — skips node_modules packages.
 */
function extractImports(content: string): string[] {
  const specifiers: string[] = [];
  const patterns = [ES_IMPORT_RE, ES_REEXPORT_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) specifiers.push(match[1]);
    }
  }

  return [...new Set(specifiers)];
}

/**
 * Find the line number where a specifier appears in the content.
 */
function findImportLine(content: string, specifier: string): number {
  const idx = content.indexOf(specifier);
  if (idx === -1) return 1;
  // Count newlines before the match
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function componentNameFromFile(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const withoutExtension = normalized.replace(/\.[^.]+$/, '');
  const segments = withoutExtension.split('/').filter(Boolean);

  if (segments[0] === 'src' || segments[0] === 'app' || segments[0] === 'lib') {
    segments.shift();
  }

  if (segments[segments.length - 1] === 'index' && segments.length > 1) {
    segments.pop();
  }

  return segments.join('/') || path.basename(withoutExtension);
}

function inferLayerFromFile(file: string): 'frontend' | 'backend' | 'database' | 'queue' | 'infra' | 'external' {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(ui|components|views|pages|frontend|web)(\/|$)/.test(normalized)) return 'frontend';
  if (/(^|\/)(db|database|prisma|drizzle|migrations)(\/|$)/.test(normalized)) return 'database';
  if (/(^|\/)(queue|queues|jobs|workers)(\/|$)/.test(normalized)) return 'queue';
  if (/(^|\/)(infra|infrastructure|terraform|k8s|docker)(\/|$)/.test(normalized)) return 'infra';
  return 'backend';
}

function buildFileComponent(file: string, timestamp: number): ArchitectureComponent {
  const name = componentNameFromFile(file);
  return {
    component_id: generateComponentId('component', name),
    name,
    type: 'component',
    role: {
      purpose: `Internal module at ${file}`,
      layer: inferLayerFromFile(file),
      critical: false,
    },
    source: {
      detection_method: 'auto',
      config_files: [file],
      confidence: 0.95,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['internal', 'module'],
    metadata: {
      file,
      kind: 'source-file',
    },
    timestamp,
    last_updated: timestamp,
  };
}

/**
 * Scan source files and build file-level import connections.
 * Accepts the already-discovered source file list from the main scanner
 * to avoid redundant glob and ensure consistent file coverage.
 */
export async function scanImports(
  projectRoot: string,
  sourceFiles?: string[]
): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];

  // Filter to TS/JS files only
  let files: string[];
  if (sourceFiles) {
    files = sourceFiles.filter(f =>
      f.endsWith('.ts') || f.endsWith('.tsx') ||
      f.endsWith('.js') || f.endsWith('.jsx')
    );
    // Exclude .d.ts files
    files = files.filter(f => !f.endsWith('.d.ts'));
  } else {
    // Fallback: use glob (shouldn't happen in normal flow)
    const { glob } = await import('glob');
    files = await glob('**/*.{ts,tsx,js,jsx}', {
      cwd: projectRoot,
      ignore: [
        '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**',
        '**/.git/**', '**/*.d.ts', '**/coverage/**',
      ],
    });
  }

  // Build a Set of known files for O(1) resolution lookups
  const knownFiles = new Set(files);
  const now = Date.now();
  const componentIdByFile = new Map<string, string>();

  for (const file of files) {
    const component = buildFileComponent(file, now);
    components.push(component);
    componentIdByFile.set(file, component.component_id);
  }

  // Read files in batches
  const batchSize = 100;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          const content = await fs.promises.readFile(
            path.join(projectRoot, file), 'utf-8'
          );
          return { file, content };
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (!result) continue;

      const { file, content } = result;
      const importerDir = path.dirname(path.join(projectRoot, file));
      const specifiers = extractImports(content);

      for (const spec of specifiers) {
        const resolved = resolveImport(spec, importerDir, projectRoot, knownFiles);
        if (!resolved) continue;

        const line = findImportLine(content, spec);
        connections.push({
          connection_id: generateConnectionId('imports'),
          from: {
            component_id: componentIdByFile.get(file) || `FILE:${file}`,
            location: { file, line },
          },
          to: {
            component_id: componentIdByFile.get(resolved) || `FILE:${resolved}`,
            location: { file: resolved, line: 1 },
          },
          connection_type: 'imports',
          code_reference: {
            file,
            symbol: spec,
            symbol_type: 'import',
            line_start: line,
          },
          detected_from: 'import-scanner',
          confidence: 1.0,
          timestamp: now,
          last_verified: now,
        });
      }
    }
  }

  return {
    components,
    connections,
    warnings: [],
  };
}
