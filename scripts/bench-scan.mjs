#!/usr/bin/env node
// Benchmark harness — runs `navgator scan` N times on a fixture directory,
// measures wall time, reports median + p95 to a markdown report.
//
// Usage:
//   node scripts/bench-scan.mjs [--runs N] [--fixture PATH] [--out PATH] [--label LABEL]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    runs: 3,
    fixture: resolve(repoRoot, '__tests__', 'fixtures', 'bench-repo'),
    out: resolve(repoRoot, '.build-loop', 'scan-engine', 'evals', 'bench.md'),
    label: 'baseline',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs' && argv[i + 1]) args.runs = Number(argv[++i]);
    else if (a === '--fixture' && argv[i + 1]) args.fixture = resolve(argv[++i]);
    else if (a === '--out' && argv[i + 1]) args.out = resolve(argv[++i]);
    else if (a === '--label' && argv[i + 1]) args.label = argv[++i];
  }
  return args;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};

const p95 = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))];
};

function runOnce(fixtureDir, cliPath) {
  const navDir = resolve(fixtureDir, '.navgator');
  if (existsSync(navDir)) rmSync(navDir, { recursive: true, force: true });

  const t0 = performance.now();
  const r = spawnSync('node', [cliPath, 'scan', '--clear'], {
    cwd: fixtureDir,
    stdio: 'pipe',
  });
  const wallMs = performance.now() - t0;
  return {
    wallMs,
    exitCode: r.status ?? -1,
    stderr: r.stderr?.toString().slice(-500) ?? '',
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cliPath = resolve(repoRoot, 'dist', 'cli', 'index.js');
  if (!existsSync(cliPath)) {
    console.error(`navgator CLI not built: ${cliPath}\nRun: npm run build`);
    process.exit(1);
  }
  if (!existsSync(args.fixture)) {
    console.error(`fixture does not exist: ${args.fixture}`);
    process.exit(1);
  }

  console.log(`bench-scan: ${args.runs} run(s) on ${args.fixture} (label=${args.label})`);
  const results = [];
  for (let i = 0; i < args.runs; i++) {
    process.stdout.write(`  run ${i + 1}/${args.runs}... `);
    const r = runOnce(args.fixture, cliPath);
    results.push(r);
    console.log(`${r.wallMs.toFixed(0)}ms (exit=${r.exitCode})`);
    if (r.exitCode !== 0 && r.stderr) console.error(`    stderr tail: ${r.stderr.trim()}`);
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  const times = results.map((r) => r.wallMs);
  const med = median(times);
  const p95v = p95(times);

  const gitSha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim();

  const report = `# bench-scan — ${args.label}

- Date: ${new Date().toISOString()}
- Git: \`${gitSha}\`
- Fixture: \`${args.fixture}\`
- Runs: ${args.runs}
- Failures: ${failed.length}

## Wall time (ms)

| metric | value |
|---|---|
| min | ${Math.min(...times).toFixed(0)} |
| median | ${med.toFixed(0)} |
| p95 | ${p95v.toFixed(0)} |
| max | ${Math.max(...times).toFixed(0)} |

## Per-run

| # | ms | exit |
|---|---|---|
${results.map((r, i) => `| ${i + 1} | ${r.wallMs.toFixed(0)} | ${r.exitCode} |`).join('\n')}
`;

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, report);
  console.log(`\nwrote ${args.out}`);
  console.log(`median: ${med.toFixed(0)}ms  p95: ${p95v.toFixed(0)}ms`);

  if (failed.length > 0) process.exit(2);
}

main();
