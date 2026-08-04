/**
 * Tests for per-capability sandbox degradation (defect B).
 *
 * A restricted scan (noChildProcess) must disable ONLY the SCIP overlay,
 * which is the sole genuine child-process dependency (scip-runner.ts uses
 * spawnSync). AST analysis (ts-morph) and prompt tracing (traceLLMCalls) run
 * in-process and must keep running. Proven here by asserting on real scan
 * output markers specific to each scanner, not on the ScanOptions flags
 * scan() was called with.
 *
 * Fixture uses the Anthropic SDK shape (`anthropic.messages.create`), mirroring
 * `__tests__/fixtures/bench-repo/src/llm.ts`. The OpenAI shape
 * (`openai.chat.completions.create`) is deliberately avoided here: it hits a
 * pre-existing anchor-matching quirk in llm-call-tracer.ts's `findCallAnchors`
 * (the greedy `(\w+(?:\.\w+)?)\.` capture swallows `.chat` before the
 * `.completions` alternative, since `chat` is itself one of the alternation
 * keywords, so the resolved caller variable becomes `openai.chat` instead of
 * `openai` and never matches a known client var). That bug is in a file this
 * chunk does not own (`src/scanners/connections/llm-call-tracer.ts`) and is
 * out of scope here — reported separately, not fixed.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scan } from '../scanner.js';

// Spy on the SCIP indexer entry point. scanner.ts reaches it through a dynamic
// `await import('./parsers/scip-runner.js')`, so the mock must be hoisted here.
// `runScip` returns a benign empty result: this file asserts WHETHER the
// indexer is reached, never what it produces, and a stub keeps the assertion
// independent of whether scip-typescript is installed on the runner.
const runScipSpy = vi.fn(async () => ({
  ok: true as const,
  edges: [],
  documents_indexed: 0,
  duration_ms: 0,
  cwd: '',
}));
vi.mock('../parsers/scip-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../parsers/scip-runner.js')>();
  return { ...actual, runScip: runScipSpy };
});

function llmFixture(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-degradation-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'degradation-fixture',
        version: '0.0.0',
        private: true,
        dependencies: { '@anthropic-ai/sdk': '^0.30.0' },
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'llm.ts'),
    [
      "import Anthropic from '@anthropic-ai/sdk';",
      '',
      "const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });",
      '',
      'export async function classifyTag(content: string): Promise<string> {',
      '  const r = await anthropic.messages.create({',
      "    model: 'claude-haiku-4-5',",
      '    max_tokens: 64,',
      '    messages: [',
      "      { role: 'user', content },",
      '    ],',
      '  });',
      "  return JSON.stringify(r);",
      '}',
      '',
    ].join('\n')
  );
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe('scan degradation (sandbox capability gating)', () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('runs AST analysis and prompt tracing under NAVGATOR_SANDBOX=1, disabling only SCIP', async () => {
    process.env.NAVGATOR_SANDBOX = '1';
    delete process.env.CODEX;
    delete process.env.CI;

    const fixture = llmFixture();
    try {
      const result = await scan(fixture.root, {
        mode: 'full',
        useAST: true,
        prompts: true,
      });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') return;

      // Proof AST ran: scanWithAST (ts-morph) tags every service component it
      // creates with 'ast-detected' (src/scanners/connections/ast-scanner.ts).
      // The regex fallback (scanServiceCalls) never adds that tag — it tags
      // only [componentType, layer]. Presence of the tag is specific to the
      // AST path having executed, not merely to a service having been found
      // by some means.
      const astComponents = result.components.filter((c) => c.tags?.includes('ast-detected'));
      expect(astComponents.length).toBeGreaterThan(0);
      expect(astComponents.some((c) => c.name === 'Claude (Anthropic)')).toBe(true);

      // Proof prompt tracing ran: traceLLMCalls emits a `type: 'llm'`
      // component per detected provider (anchor-based on the Anthropic SDK
      // import + client init + `.messages.create` call in the fixture).
      const llmComponents = result.components.filter((c) => c.type === 'llm');
      expect(llmComponents.length).toBeGreaterThan(0);
      expect(llmComponents.some((c) => c.name === 'anthropic')).toBe(true);

      // Degradation record: only SCIP is disabled; AST/prompts are not named.
      expect(result.degraded).toBeDefined();
      expect(result.degraded?.disabled_capabilities).toContain('scip');
      expect(result.degraded?.disabled_capabilities).not.toContain('useAST');
      expect(result.degraded?.disabled_capabilities).not.toContain('prompts');
      expect(result.degraded?.restrictions).toContain('noChildProcess');
    } finally {
      fixture.cleanup();
    }
  });

  // Regression: `options.scip = false` alone did NOT suppress an ambient
  // NAVGATOR_SCIP=1, so a sandboxed run would still reach the SCIP indexer —
  // which shells out via spawnSync — in an environment that forbids child
  // processes. The old blanket `options.quick = true` hid this by skipping all
  // of Phase 3, so removing that hammer made the gap live.
  //
  // The invariant under test is "the indexer is never reached", so this asserts
  // at the module seam rather than on scan output. Two earlier drafts asserted
  // on SCIP-derived edges instead and both passed vacuously — SCIP emits only
  // CROSS-FILE edges, and a run that finds none is indistinguishable from a run
  // that never happened. A call spy cannot be satisfied that way, and it needs
  // no real indexer run (no 60s subprocess on a 2-core CI runner).
  it('never reaches the SCIP indexer when sandboxed, even with NAVGATOR_SCIP=1', async () => {
    const fixture = llmFixture();
    fs.writeFileSync(
      path.join(fixture.root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' }, include: ['src'] }, null, 2)
    );
    try {
      delete process.env.NAVGATOR_SANDBOX;
      delete process.env.CODEX;
      delete process.env.CI;
      process.env.NAVGATOR_SCIP = '1';

      // Control: same env, no sandbox. Proves the gate is what stops the call
      // below, rather than the fixture being unable to reach SCIP at all.
      await scan(fixture.root, { mode: 'full', useAST: true });
      expect(runScipSpy.mock.calls.length).toBeGreaterThan(0);

      runScipSpy.mockClear();
      process.env.NAVGATOR_SANDBOX = '1';
      const sandboxed = await scan(fixture.root, { mode: 'full', useAST: true });

      expect(runScipSpy).not.toHaveBeenCalled();
      expect(sandboxed.degraded?.disabled_capabilities).toContain('scip');
    } finally {
      fixture.cleanup();
    }
  });

  // CODEX=1 sets BOTH noChildProcess and readOnlyFs (src/sandbox.ts). This is
  // the shape the whole degradation change targets, but it was previously
  // untested: `message` only ever named `noChildProcess`, so under CODEX=1 the
  // human banner / JSON `degraded.message` would list `readOnlyFs` in
  // `restrictions` without ever explaining it. Asserted structurally (every
  // restriction name must appear in `message`) rather than against one
  // hardcoded sentence, so this keeps working when the wording changes.
  //
  // NavGator's own `readOnlyFs` flag is advisory: nothing in this codebase
  // gates a filesystem write on it (see the comment above `detectSandbox()`
  // call in scanner.ts), so it does not make this test's tmpdir actually
  // read-only, and `acquireScanLease`'s unguarded `fs.mkdirSync` (a known,
  // documented gap — see that same comment) does not throw here. That is
  // consistent with "scan() throws instead of degrading" being a real but
  // untriggered-in-this-harness limitation, not a claim this test can
  // exercise without a genuinely read-only filesystem.
  it('runs a complete degraded scan under CODEX=1 and names every restriction in message', async () => {
    delete process.env.NAVGATOR_SANDBOX;
    process.env.CODEX = '1';
    delete process.env.CI;

    const fixture = llmFixture();
    try {
      const result = await scan(fixture.root, {
        mode: 'full',
        useAST: true,
        prompts: true,
      });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') return;

      expect(result.degraded).toBeDefined();
      expect(result.degraded?.restrictions).toEqual(['noChildProcess', 'readOnlyFs']);
      expect(result.degraded?.disabled_capabilities).toEqual(['scip']);

      // Structural completeness check: every named restriction must be
      // mentioned in the human-readable message, not just the first one.
      const message = result.degraded?.message ?? '';
      for (const restriction of result.degraded?.restrictions ?? []) {
        expect(message).toContain(restriction);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('leaves degraded undefined for a normal (non-sandbox) scan', async () => {
    delete process.env.NAVGATOR_SANDBOX;
    delete process.env.CODEX;
    delete process.env.CI;

    const fixture = llmFixture();
    try {
      const result = await scan(fixture.root, { mode: 'full', useAST: true, prompts: true });

      expect(result.status).toBe('completed');
      if (result.status !== 'completed') return;

      expect(result.degraded).toBeUndefined();
      // Sanity: the fixture's AST/prompt evidence is still present on a
      // complete scan — a degraded scan wasn't just silently equivalent.
      expect(result.components.some((c) => c.type === 'llm')).toBe(true);
      expect(result.components.some((c) => c.tags?.includes('ast-detected'))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
