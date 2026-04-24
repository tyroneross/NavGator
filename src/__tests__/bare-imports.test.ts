/**
 * Tests for bare-import (uses-package) edge emission in import-scanner.
 *
 * Validates that `import X from "pkg"` and `require("pkg")` in source files
 * emit `uses-package` connections to matching npm package components.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanImports, KnownPackage } from '../scanners/connections/import-scanner.js';
import type { ArchitectureConnection } from '../types.js';

/**
 * Build a temp project on disk with the given files, run scanImports against it,
 * and return the resulting connections. Files are written under a unique tmp dir.
 */
async function runScan(
  files: Record<string, string>,
  knownPackages: KnownPackage[]
): Promise<{
  connections: Awaited<ReturnType<typeof scanImports>>['connections'];
  components: Awaited<ReturnType<typeof scanImports>>['components'];
  cleanup: () => void;
}> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-bare-'));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  const sourceFiles = Object.keys(files);
  const result = await scanImports(tmpRoot, sourceFiles, knownPackages);
  return {
    connections: result.connections,
    components: result.components,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

function usesPackageEdges(connections: ArchitectureConnection[]): ArchitectureConnection[] {
  return connections.filter((c) => c.connection_type === 'uses-package');
}

describe('bare-import edges (uses-package)', () => {
  const knownPackages: KnownPackage[] = [
    { name: 'react', component_id: 'COMP_npm_react_abc1' },
    { name: '@radix-ui/react-dialog', component_id: 'COMP_npm_radix_abc2' },
    { name: 'tailwindcss-animate', component_id: 'COMP_npm_tw_abc3' },
    { name: 'drizzle-orm', component_id: 'COMP_db_drizzle_abc4' },
  ];

  let tmps: Array<() => void> = [];
  afterAll(() => {
    for (const cleanup of tmps) cleanup();
  });

  it('plain `import X from "react"` emits uses-package edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/app.ts': `import React from "react";\nexport const x = React;\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_react_abc1');
    expect(edges[0].code_reference.symbol).toBe('react');
  });

  it('scoped `import X from "@scope/pkg"` emits uses-package edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/dialog.tsx': `import * as Dialog from "@radix-ui/react-dialog";\nexport { Dialog };\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_radix_abc2');
    expect(edges[0].code_reference.symbol).toBe('@radix-ui/react-dialog');
  });

  it('scoped subpath `@scope/pkg/subpath` strips to @scope/pkg', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/dialog.tsx': `import { Root } from "@radix-ui/react-dialog/Root";\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_radix_abc2');
    expect(edges[0].code_reference.symbol).toBe('@radix-ui/react-dialog');
  });

  it('unscoped subpath `react/jsx-runtime` strips to react', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/jsx.ts': `import { jsx } from "react/jsx-runtime";\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_react_abc1');
    expect(edges[0].code_reference.symbol).toBe('react');
  });

  it('relative `./rel` import does NOT emit uses-package edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/a.ts': `import { b } from "./b";\nexport const x = b;\n`,
        'src/b.ts': `export const b = 1;\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(0);
  });

  it('bare `require("pkg")` in tailwind.config.ts emits uses-package edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'tailwind.config.ts': `module.exports = {\n  plugins: [require("tailwindcss-animate")],\n};\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_tw_abc3');
    expect(edges[0].code_reference.symbol).toBe('tailwindcss-animate');
  });

  it('bare import of an UNKNOWN package is silently skipped (no ghost node)', async () => {
    const { connections, components, cleanup } = await runScan(
      {
        'src/ghost.ts': `import "this-package-does-not-exist";\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(0);
    // No component was invented for the unknown package
    expect(components.find((c) => c.name === 'this-package-does-not-exist')).toBeUndefined();
  });

  it('multiple imports of same package from one file dedupe to a single edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/multi.tsx': [
          `import React from "react";`,
          `import { useState } from "react";`,
          `import { jsx } from "react/jsx-runtime";`,
          `export default React;`,
        ].join('\n'),
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    // 3 source imports all resolve to `react` → one edge (deduped per-file)
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_react_abc1');
  });

  it('dynamic import `import("pkg")` emits uses-package edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/lazy.ts': `async function load() { return await import("drizzle-orm"); }\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_db_drizzle_abc4');
  });

  it('re-export `export { X } from "pkg"` emits uses-package edge', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/reexport.ts': `export { default as React } from "react";\n`,
      },
      knownPackages
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(1);
    expect(edges[0].to.component_id).toBe('COMP_npm_react_abc1');
  });

  it('no knownPackages supplied → no uses-package edges emitted (backwards-compat)', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/a.ts': `import React from "react";\n`,
      },
      [] // empty
    );
    tmps.push(cleanup);

    expect(usesPackageEdges(connections)).toHaveLength(0);
  });

  it('Node builtin `node:fs` is never emitted as uses-package', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/io.ts': `import * as fs from "node:fs";\nimport path from "node:path";\n`,
      },
      // Even if someone had a package named "fs" tracked, the node: prefix
      // would exclude it from matching.
      [...knownPackages, { name: 'fs', component_id: 'COMP_npm_fs_fake' }]
    );
    tmps.push(cleanup);

    const edges = usesPackageEdges(connections);
    expect(edges).toHaveLength(0);
  });

  it('plain `fs` builtin without node: prefix is silently skipped when not in knownPackages', async () => {
    const { connections, cleanup } = await runScan(
      {
        'src/io.ts': `import * as fs from "fs";\n`,
      },
      knownPackages // no "fs" entry
    );
    tmps.push(cleanup);

    expect(usesPackageEdges(connections)).toHaveLength(0);
  });
});
