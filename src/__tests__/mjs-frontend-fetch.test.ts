/**
 * Regression tests for two scanner blind spots discovered in agent-studio
 * (NavGator lessons navg-mjs-skip + navg-fetch-miss).
 *
 *   1. The main file glob in `scanner.ts` and `import-scanner.ts` skipped
 *      `.mjs` and `.cjs` files entirely, so anything in `app/lib/*.mjs` was
 *      invisible to the architecture graph.
 *
 *   2. The fetch('/api/...') second pass in `import-scanner.ts` filtered with
 *      `file.includes('/app/')`, which never matches top-level `app/page.js`
 *      or `app/canvas/page.js` (no leading slash). Frontend pages at the
 *      project root were silently excluded from API-call detection,
 *      surfacing as false-positive orphan endpoints in `navgator dead`.
 *
 *   3. `resolveApiRoute` only considered `route.{ts,tsx,js}` route files,
 *      missing Next.js App Router routes authored as `route.mjs` / `route.cjs`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanImports } from '../scanners/connections/import-scanner.js';
import { scanServiceCalls } from '../scanners/connections/service-calls.js';
import type { ArchitectureConnection } from '../types.js';

async function runScan(
  files: Record<string, string>
): Promise<{
  connections: ArchitectureConnection[];
  cleanup: () => void;
}> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-mjs-'));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  const sourceFiles = Object.keys(files);
  const result = await scanImports(tmpRoot, sourceFiles);
  return {
    connections: result.connections,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const c of cleanups) c();
});

describe('top-level Next.js app/ pages emit frontend-calls-api edges', () => {
  it('app/canvas/page.js fetch("/api/agent/infer-edges") wires to route.js', async () => {
    const pageContent = `
      'use client';
      export default function Canvas() {
        async function infer() {
          const res = await fetch("/api/agent/infer-edges", {
            method: "POST",
            body: JSON.stringify({}),
          });
          return res.json();
        }
        return null;
      }
    `;
    const routeContent = `
      export async function POST(req) {
        return new Response(JSON.stringify({ ok: true }));
      }
    `;
    const { connections, cleanup } = await runScan({
      'app/canvas/page.js': pageContent,
      'app/api/agent/infer-edges/route.js': routeContent,
    });
    cleanups.push(cleanup);

    const fetchEdges = connections.filter(
      (c) => c.connection_type === 'frontend-calls-api'
    );
    expect(fetchEdges, 'top-level app/canvas/page.js should produce a frontend-calls-api edge').toHaveLength(1);
    expect(fetchEdges[0].from.component_id).toContain('canvas');
    expect(fetchEdges[0].to.component_id).toContain('infer_edge');
  });

  it('top-level app/page.js fetch wires to route', async () => {
    const { connections, cleanup } = await runScan({
      'app/page.js': `export default function P() { fetch("/api/health"); return null; }`,
      'app/api/health/route.js': `export async function GET() { return new Response("ok"); }`,
    });
    cleanups.push(cleanup);

    const fetchEdges = connections.filter(
      (c) => c.connection_type === 'frontend-calls-api'
    );
    expect(fetchEdges).toHaveLength(1);
  });

  it('survives in a 2500-line file (no AST or content cap)', async () => {
    // Reproduce the canvas/page.js scale: ~2.5K lines of filler around the fetch.
    const pad = Array.from({ length: 1200 }, (_, i) => `// filler line ${i}`).join('\n');
    const fetchSite = `
      async function writeSpec() {
        const res = await fetch("/api/fs/write-spec", { method: "POST" });
        return res.json();
      }
    `;
    const morePad = Array.from({ length: 1200 }, (_, i) => `// trailing line ${i}`).join('\n');
    const big = `'use client';\n${pad}\n${fetchSite}\n${morePad}\n`;
    expect(big.split('\n').length).toBeGreaterThan(2400);

    const { connections, cleanup } = await runScan({
      'app/canvas/page.js': big,
      'app/api/fs/write-spec/route.js': `export async function POST() { return new Response("ok"); }`,
    });
    cleanups.push(cleanup);

    const fetchEdges = connections.filter(
      (c) => c.connection_type === 'frontend-calls-api'
    );
    expect(fetchEdges, 'fetch in a 2.5K-line file must still be detected').toHaveLength(1);
  });
});

describe('resolveApiRoute supports route.mjs / route.cjs', () => {
  it('detects fetch → app/api/foo/route.mjs', async () => {
    const { connections, cleanup } = await runScan({
      'app/components/Caller.js': `export default function C() { fetch("/api/foo"); return null; }`,
      'app/api/foo/route.mjs': `export async function GET() { return new Response("ok"); }`,
    });
    cleanups.push(cleanup);

    const fetchEdges = connections.filter(
      (c) => c.connection_type === 'frontend-calls-api'
    );
    expect(fetchEdges).toHaveLength(1);
  });

  it('detects fetch → app/api/bar/route.cjs', async () => {
    const { connections, cleanup } = await runScan({
      'app/components/Caller.js': `export default function C() { fetch("/api/bar"); return null; }`,
      'app/api/bar/route.cjs': `module.exports.GET = async () => new Response("ok");`,
    });
    cleanups.push(cleanup);

    const fetchEdges = connections.filter(
      (c) => c.connection_type === 'frontend-calls-api'
    );
    expect(fetchEdges).toHaveLength(1);
  });
});

describe('Ollama service detection (lesson navg-llm-blind)', () => {
  async function runServiceScan(files: Record<string, string>) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-ollama-'));
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(tmpRoot, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
    }
    const result = await scanServiceCalls(tmpRoot);
    cleanups.push(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
    return result;
  }

  it('detects Ollama in a .mjs file using OLLAMA_BASE_URL + fetch', async () => {
    const runtime = `
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      export async function chat(messages) {
        const res = await fetch(\`\${baseUrl}/api/chat\`, {
          method: "POST",
          body: JSON.stringify({ model: "gpt-oss:20b", messages, stream: false }),
        });
        return res.json();
      }
    `;
    const result = await runServiceScan({ 'app/lib/agent-runtime.mjs': runtime });
    const ollamaConn = result.connections.find((c) =>
      result.components.some(
        (cc) => cc.component_id === c.to.component_id && /ollama/i.test(cc.name)
      )
    );
    expect(ollamaConn, 'Ollama call from .mjs runtime should produce a service-call edge').toBeTruthy();
  });

  it('detects Ollama in a .js route handler using OLLAMA_MODEL', async () => {
    const route = `
      const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b";
      export async function POST(req) {
        const res = await fetch(\`\${DEFAULT_BASE_URL}/api/chat\`, {
          method: "POST",
          body: JSON.stringify({ model: DEFAULT_MODEL, messages: [], format: "json" }),
        });
        return res;
      }
    `;
    const result = await runServiceScan({ 'app/api/agent/infer-edges/route.js': route });
    const ollamaCount = result.connections.filter((c) =>
      result.components.some(
        (cc) => cc.component_id === c.to.component_id && /ollama/i.test(cc.name)
      )
    ).length;
    expect(ollamaCount).toBeGreaterThanOrEqual(1);
  });
});

describe('relative imports of .mjs files resolve', () => {
  it('app/canvas/page.js → import "../lib/storage-config" finds storage-config.mjs', async () => {
    const { connections, cleanup } = await runScan({
      'app/canvas/page.js': `import { cfg } from '../lib/storage-config';\nexport default () => cfg;\n`,
      'app/lib/storage-config.mjs': `export const cfg = { mode: 'local' };\n`,
    });
    cleanups.push(cleanup);

    const importEdges = connections.filter((c) => c.connection_type === 'imports');
    expect(importEdges, 'import of bare-name should resolve to .mjs sibling').toHaveLength(1);
    expect(importEdges[0].to.component_id).toContain('storage_config');
  });
});
