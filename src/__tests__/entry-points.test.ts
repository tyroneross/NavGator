/**
 * Entry-point resolution — the roots reachability starts from.
 *
 * The defect these tests exist to hold closed: NavGator's own graph reported 425
 * of 451 project components as `transitively-dead` because the root set had no
 * notion of an npm package. Every root came from the `infra`/`external`
 * fallback, and external nodes are graph sinks, so the traversal covered 16 of
 * 521 nodes.
 *
 * Each assertion below names a specific declaration a package makes about where
 * execution starts. Deleting the corresponding branch in `entry-points.ts` fails
 * a named test here, which is what stops the root set silently narrowing again.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ArchitectureComponent, ComponentType } from '../types.js';
import {
  classifyPathConvention,
  declaredEntryPaths,
  detectEntryPoints,
  resolveDeclaredTarget,
} from '../entry-points.js';

function comp(
  name: string,
  file: string,
  opts: { type?: ComponentType; layer?: ArchitectureComponent['role']['layer']; tags?: string[] } = {}
): ArchitectureComponent {
  return {
    component_id: `COMP_${name.replace(/[^a-z0-9]/gi, '_')}`,
    name,
    type: opts.type ?? 'component',
    role: { purpose: '', layer: opts.layer ?? 'backend', critical: false },
    source: { detection_method: 'auto', config_files: [file], confidence: 1 },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: opts.tags ?? [],
    timestamp: 0,
    last_updated: 0,
  };
}

// ---------------------------------------------------------------------------
// Declared paths — what the manifest says
// ---------------------------------------------------------------------------

describe('declaredEntryPaths', () => {
  it('reads bin, main, module, and exports as the published entry surface', () => {
    const declared = declaredEntryPaths({
      main: 'dist/index.js',
      module: 'dist/index.mjs',
      bin: { navgator: 'dist/cli/index.js' },
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './scanner': { import: './dist/scanner.js' },
      },
    });
    const targets = declared.map((d) => d.target);

    expect(targets).toContain('dist/cli/index.js');
    expect(targets).toContain('dist/index.js');
    expect(targets).toContain('dist/index.mjs');
    expect(targets).toContain('dist/scanner.js');
    // `types` declares no runtime entry, so it must not become a root.
    expect(targets).not.toContain('./dist/index.d.ts');
    expect(targets.every((t) => !t.endsWith('.d.ts'))).toBe(true);
  });

  it('treats a string bin as the single entry', () => {
    const declared = declaredEntryPaths({ bin: './bin/run.js' });
    expect(declared.map((d) => d.target)).toEqual(['bin/run.js']);
  });

  it('pulls file paths out of npm scripts, the only declaration some entries have', () => {
    // `npm run mcp` is the sole statement that src/mcp/server.ts runs at all —
    // nothing in the codebase imports it.
    const declared = declaredEntryPaths({
      scripts: {
        mcp: 'node dist/mcp/server.js',
        build: 'tsc && node scripts/prepare.mjs',
        test: 'vitest run',
      },
    });
    const targets = declared.map((d) => d.target);

    expect(targets).toContain('dist/mcp/server.js');
    expect(targets).toContain('scripts/prepare.mjs');
    // Bare binaries are not paths and must not be resolved as such.
    expect(targets).not.toContain('vitest');
    expect(targets).not.toContain('tsc');
  });

  it('takes explicitly named files from the publish allowlist but not directories', () => {
    // web/server.cjs is spawned as a child process — an edge no import graph
    // carries — and `files` is the only place the package declares it.
    const declared = declaredEntryPaths({ files: ['dist', 'web/server.cjs', 'skills'] });
    const targets = declared.map((d) => d.target);

    expect(targets).toContain('web/server.cjs');
    expect(targets).not.toContain('dist');
    expect(targets).not.toContain('skills');
  });

  it('prefixes a workspace manifest directory so targets stay project-relative', () => {
    const declared = declaredEntryPaths({ main: './src/index.ts' }, 'packages/api');
    expect(declared.map((d) => d.target)).toEqual(['packages/api/src/index.ts']);
  });

  it('refuses absolute paths, parent-directory escapes, and globs', () => {
    const declared = declaredEntryPaths({
      main: '/etc/passwd',
      module: '../../outside/index.js',
      browser: 'dist/*.js',
    });
    expect(declared).toEqual([]);
  });

  it('returns nothing for a non-object manifest instead of throwing', () => {
    expect(declaredEntryPaths(null)).toEqual([]);
    expect(declaredEntryPaths('not a manifest')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Target resolution — manifest points at build output, the graph holds source
// ---------------------------------------------------------------------------

describe('resolveDeclaredTarget', () => {
  it('maps compiled output back to the source path the graph actually holds', () => {
    const candidates = resolveDeclaredTarget('dist/cli/index.js');
    expect(candidates).toContain('src/cli/index.ts');
    expect(candidates).toContain('cli/index.ts');
    expect(candidates).toContain('dist/cli/index.js');
  });

  it('resolves an extensionless target through its directory index', () => {
    expect(resolveDeclaredTarget('dist/scanner')).toContain('src/scanner/index.ts');
    expect(resolveDeclaredTarget('dist/scanner')).toContain('src/scanner.ts');
  });

  it('handles a nested output directory under a workspace', () => {
    expect(resolveDeclaredTarget('web/dist/server.js')).toContain('web/src/server.ts');
    expect(resolveDeclaredTarget('web/dist/server.js')).toContain('web/server.ts');
  });

  it('keeps a target that already points at source', () => {
    expect(resolveDeclaredTarget('web/server.cjs')).toContain('web/server.cjs');
  });
});

// ---------------------------------------------------------------------------
// Path conventions — roots nothing imports
// ---------------------------------------------------------------------------

describe('classifyPathConvention', () => {
  it('treats Next.js app-router files as routes', () => {
    expect(classifyPathConvention('web/app/page.tsx')).toBe('framework-route');
    expect(classifyPathConvention('web/app/projects/[id]/route.ts')).toBe('framework-route');
    expect(classifyPathConvention('web/app/layout.tsx')).toBe('framework-route');
    expect(classifyPathConvention('web/middleware.ts')).toBe('framework-route');
  });

  it('treats every pages-router file as a route', () => {
    expect(classifyPathConvention('pages/about.tsx')).toBe('framework-route');
    expect(classifyPathConvention('web/pages/about.tsx')).toBe('framework-route');
    expect(classifyPathConvention('web/src/pages/about.tsx')).toBe('framework-route');
  });

  it('anchors the router conventions to an app root, not to any nested folder', () => {
    // `components/pages/` and `lib/pages/` are ordinary component folders. Next
    // only routes `pages/` and `app/` at the app root (optionally under `src/`).
    expect(classifyPathConvention('web/components/pages/Landing.tsx')).toBeNull();
    expect(classifyPathConvention('src/lib/pages/Profile.tsx')).toBeNull();
    expect(classifyPathConvention('src/lib/app/page.tsx')).toBeNull();
  });

  it('treats test files as roots because a runner discovers them', () => {
    expect(classifyPathConvention('src/__tests__/rules.test.ts')).toBe('test-file');
    expect(classifyPathConvention('src/thing.spec.ts')).toBe('test-file');
  });

  it('treats tool-loaded config and executable directories as roots', () => {
    expect(classifyPathConvention('vitest.config.ts')).toBe('tooling-config');
    expect(classifyPathConvention('web/next.config.mjs')).toBe('tooling-config');
    expect(classifyPathConvention('scripts/verify-release.mjs')).toBe('executable-dir');
    expect(classifyPathConvention('packages/api/bin/serve.js')).toBe('executable-dir');
  });

  it('does not mistake React custom-hook directories for executables', () => {
    // `hooks/` was in the executable list until measurement showed it admitting
    // 16 library modules in this repo. An over-broad entry-point source makes
    // dead code in that directory permanently unreportable.
    expect(classifyPathConvention('web/hooks/use-toast.ts')).toBeNull();
    expect(classifyPathConvention('web/lib/hooks/use-status.ts')).toBeNull();
    expect(classifyPathConvention('hooks/session-start.ts')).toBeNull();
    expect(classifyPathConvention('src/tools/registry.ts')).toBeNull();
  });

  it('does not admit ordinary source as a root', () => {
    expect(classifyPathConvention('src/rules.ts')).toBeNull();
    expect(classifyPathConvention('web/components/ui/button.tsx')).toBeNull();
    // A component named `app.ts` is not an app-router page.
    expect(classifyPathConvention('src/app.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end against a real manifest on disk
// ---------------------------------------------------------------------------

describe('detectEntryPoints', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-entry-'));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture-cli',
        main: 'dist/index.js',
        bin: { fixture: 'dist/cli/index.js' },
        scripts: { mcp: 'node dist/mcp/server.js' },
        files: ['dist', 'web/server.cjs'],
      })
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves the package bin to its source component', () => {
    const cli = comp('cli', 'src/cli/index.ts');
    const helper = comp('helper', 'src/helper.ts');
    const result = detectEntryPoints([cli, helper], { projectRoot: root });

    expect(result.ids.has(cli.component_id)).toBe(true);
    expect(result.reasons.get(cli.component_id)).toBe('package-entry');
    expect(result.ids.has(helper.component_id)).toBe(false);
  });

  it('resolves main, an npm script, and a published file in the same pass', () => {
    const index = comp('index', 'src/index.ts');
    const mcp = comp('mcp/server', 'src/mcp/server.ts');
    const launcher = comp('web/server', 'web/server.cjs');
    const result = detectEntryPoints([index, mcp, launcher], { projectRoot: root });

    expect(result.reasons.get(index.component_id)).toBe('package-entry');
    expect(result.reasons.get(mcp.component_id)).toBe('package-script');
    expect(result.reasons.get(launcher.component_id)).toBe('package-file');
  });

  it('finds nothing from the manifest when manifest reading is skipped', () => {
    const cli = comp('cli', 'src/cli/index.ts');
    const result = detectEntryPoints([cli], { projectRoot: root, skipManifests: true });

    expect(result.ids.has(cli.component_id)).toBe(false);
    expect(result.manifests).toEqual([]);
  });

  it('keeps the pre-existing type, name, tag, and layer roots', () => {
    const endpoint = comp('GET /health', 'src/routes/health.ts', { type: 'api-endpoint' });
    const appDelegate = comp('AppDelegate', 'App/AppDelegate.swift');
    const tagged = comp('tagged', 'src/tagged.ts', { tags: ['entrypoint'] });
    const external = comp('openai', 'package.json', { type: 'service', layer: 'external' });
    const result = detectEntryPoints([endpoint, appDelegate, tagged, external], {
      projectRoot: root,
    });

    expect(result.reasons.get(endpoint.component_id)).toBe('component-type');
    expect(result.reasons.get(appDelegate.component_id)).toBe('name-pattern');
    expect(result.reasons.get(tagged.component_id)).toBe('tag');
    expect(result.reasons.get(external.component_id)).toBe('infra-layer');
  });

  it('reports counts per source so a root set is auditable', () => {
    const cli = comp('cli', 'src/cli/index.ts');
    const test = comp('rules.test', 'src/__tests__/rules.test.ts');
    const result = detectEntryPoints([cli, test], { projectRoot: root });

    expect(result.counts['package-entry']).toBe(1);
    expect(result.counts['test-file']).toBe(1);
    expect(result.manifests).toEqual(['package.json']);
  });

  it('refuses to follow a symlink out of the project root', () => {
    // The containment check used to be lexical, so `path.resolve` produced a
    // path that passed a prefix compare while the real file sat outside the
    // root. `origin_root` comes from scan data, so this is reachable input.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-outside-'));
    const inside = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-inside-'));
    try {
      fs.writeFileSync(
        path.join(outside, 'package.json'),
        JSON.stringify({ main: 'pwned.js' })
      );
      fs.writeFileSync(path.join(inside, 'package.json'), JSON.stringify({ main: 'ok.js' }));
      fs.symlinkSync(outside, path.join(inside, 'escape'));

      const c = comp('thing', 'src/thing.ts');
      c.metadata = { origin_root: 'escape' };
      const result = detectEntryPoints([c], { projectRoot: inside });

      expect(result.manifests).toEqual(['package.json']);
      expect(result.declared).not.toContain('escape/pwned.js');
      expect(result.declared.some(d => d.includes('pwned'))).toBe(false);
    } finally {
      fs.rmSync(inside, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports an unparseable manifest instead of silently narrowing the root set', () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-broken-'));
    try {
      fs.writeFileSync(path.join(broken, 'package.json'), '{ this is not json');
      const result = detectEntryPoints([comp('thing', 'src/thing.ts')], { projectRoot: broken });

      expect(result.manifest_errors).toEqual(['package.json']);
      expect(result.manifests).toEqual([]);
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });

  it('survives a project root with no manifest at all', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-entry-empty-'));
    try {
      const src = comp('thing', 'src/thing.ts');
      const result = detectEntryPoints([src], { projectRoot: empty });
      expect(result.manifests).toEqual([]);
      expect(result.ids.size).toBe(0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
