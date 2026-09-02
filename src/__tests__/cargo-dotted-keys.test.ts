/**
 * Guard tests for TOML dotted-key dependency syntax in Cargo.toml.
 *
 * The defect these exist to prevent: `serde.workspace = true` was parsed as a
 * crate literally named "serde.workspace" with version "true". On a real
 * workspace repo that produced 66 phantom external packages, none of which
 * resolve against any registry (refresh-external: 0 of 67 resolved), and it
 * hid every workspace-inherited dependency plus every internal path crate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanCargoPackages } from '../scanners/packages/cargo.js';

const ROOT = `[workspace]
members = ["crates/ambient-store"]

[workspace.dependencies]
ambient-ledger = { path = "crates/ambient-ledger" }
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = "=1.0.151"
`;

const MEMBER = `[package]
name = "ambient-store"
version = "0.1.0"

[dependencies]
ambient-ledger.workspace = true
serde.workspace = true
serde_json.workspace = true
plain-dep = "=1.2.3"
`;

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-cargo-'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), ROOT);
  const crate = path.join(dir, 'crates', 'ambient-store');
  fs.mkdirSync(crate, { recursive: true });
  fs.writeFileSync(path.join(crate, 'Cargo.toml'), MEMBER);
  return dir;
}

describe('cargo dotted-key dependencies', () => {
  const dir = fixture();
  let names: string[] = [];
  let components: any[] = [];

  beforeAll(async () => {
    const result = await scanCargoPackages(dir);
    components = result.components as any[];
    names = components.map((c) => c.name);
  });

  it('never invents a component whose name contains a dot', () => {
    const dotted = names.filter((n) => n.includes('.'));
    expect(dotted).toEqual([]);
  });

  it('resolves the real crate name from the dotted key', () => {
    expect(names).toContain('serde');
    expect(names).toContain('serde_json');
    expect(names).not.toContain('serde.workspace');
  });

  it('still parses a plain version dependency', () => {
    expect(names).toContain('plain-dep');
  });

  it('does not record "true" as a version', () => {
    for (const c of components) {
      expect(c.version).not.toBe('true');
    }
  });
});
