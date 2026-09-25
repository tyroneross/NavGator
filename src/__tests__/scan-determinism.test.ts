/**
 * Two full scans of the same unchanged tree must produce the same graph and
 * the same rule violations, whatever order the filesystem walk returns files.
 *
 * `glob` (v9+) walks asynchronously and does not guarantee result order; on
 * a real repo the order changed from run to run. Several scanners keep the
 * FIRST occurrence of something (the first file importing an entitlement
 * framework, the first declaration of a type name), so a different walk
 * order produced a different graph and different orphan/dead findings.
 *
 * This test replaces the walker's order: scan 1 sees every glob result in
 * ascending order, scan 2 sees it reversed. The graphs, compared by
 * name/type/file/line rather than by the random component ids, must match.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const walkOrder = vi.hoisted(() => ({ reverse: false }));

vi.mock('glob', async (importOriginal) => {
  const real = await importOriginal<typeof import('glob')>();
  const order = <T>(r: T): T => {
    if (!Array.isArray(r)) return r;
    const copy = [...r].sort();
    return (walkOrder.reverse ? copy.reverse() : copy) as T;
  };
  const glob = (async (...args: Parameters<typeof real.glob>) =>
    order(await real.glob(...args))) as typeof real.glob;
  const globSync = ((...args: Parameters<typeof real.globSync>) =>
    order(real.globSync(...args))) as typeof real.globSync;
  return { ...real, glob, globSync };
});

import { scan } from '../scanner.js';
import { getBuiltinRules, checkRules } from '../rules.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';

let root: string;

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-determinism-'));
  write('Package.swift', '// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: "Demo")\n');
  write('Sources/Demo/DemoApp.swift', '@main\nstruct DemoApp { static func main() { AlphaNotifier().go(); BetaNotifier().go() } }\n');
  // Two files import the same entitlement-bearing framework.
  write('Sources/Demo/AlphaNotifier.swift', 'import UserNotifications\nstruct AlphaNotifier { func go() {} }\n');
  write('Sources/Demo/BetaNotifier.swift', 'import UserNotifications\nstruct BetaNotifier { func go() {} }\n');
  // Same type name declared twice: which declaration wins must not depend on walk order.
  write('Sources/Demo/Shared.swift', 'struct Token { let v: Int }\n');
  write('Sources/Other/Shared2.swift', 'struct Token { let w: Int }\nstruct UsesToken { let t: Token }\n');

  write('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n');
  write('src/main.rs', 'mod a;\nmod b;\nfn main() { a::run(); b::run(); }\n');
  write('src/a.rs', 'pub struct Vector;\npub fn run() {}\n');
  write('src/b.rs', 'pub struct Vector;\npub fn run() {}\n');
  write('tests/one.rs', 'fn t() { let _ = Vector; }\n');
  write('tests/two.rs', 'fn t() { let _ = Vector; }\n');

  write('package.json', JSON.stringify({ name: 'det', version: '0.0.0' }));
  write('web/index.ts', "import { helper } from './helper';\nhelper();\n");
  write('web/helper.ts', 'export function helper() {}\n');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function normalize(components: ArchitectureComponent[], connections: ArchitectureConnection[]) {
  const nameOf = new Map(components.map(c => [c.component_id, `${c.type}:${c.name}`]));
  const label = (id: string) => nameOf.get(id) ?? id;
  const comps = components.map(c => `${c.type}:${c.name}`).sort();
  const edges = connections
    .map(c => [
      label(c.from.component_id),
      c.connection_type,
      label(c.to.component_id),
      c.code_reference?.file ?? '',
      c.code_reference?.line_start ?? '',
      c.code_reference?.symbol ?? '',
    ].join(' | '))
    .sort();
  const violations = checkRules(components, connections, getBuiltinRules(root))
    .map(v => `${v.rule_id} | ${label(v.component_id ?? '')} | ${v.message}`)
    .sort();
  return { comps, edges, violations };
}

describe('scan determinism', () => {
  it('produces the same graph and violations when the file walk order is reversed', async () => {
    walkOrder.reverse = false;
    const first = await scan(root, { mode: 'full' });
    walkOrder.reverse = true;
    const second = await scan(root, { mode: 'full' });

    const a = normalize(first.components, first.connections);
    const b = normalize(second.components, second.connections);
    expect(a.edges.length).toBeGreaterThan(0);
    expect(b.comps).toEqual(a.comps);
    expect(b.edges).toEqual(a.edges);
    expect(b.violations).toEqual(a.violations);
  }, 120_000);

  it('routes every scanner glob through the sorted wrapper', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (entry.name.endsWith('.ts') && entry.name !== 'sorted-glob.ts') {
          const text = fs.readFileSync(full, 'utf-8');
          if (/from\s+['"]glob['"]|import\(\s*['"]glob['"]\s*\)/.test(text)) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
