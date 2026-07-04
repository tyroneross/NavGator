/**
 * Tests for Rust/Cargo package detection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scan } from '../scanner.js';
import { detectCargo, scanCargoPackages } from '../scanners/packages/cargo.js';
let tmp;
function writeFixture(relPath, content) {
    const fullPath = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
}
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-cargo-'));
});
afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});
describe('scanCargoPackages', () => {
    it('detects direct, dev, build, target, path, git, and renamed Cargo dependencies', async () => {
        writeFixture('Cargo.toml', `
[package]
name = "api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
serde = { version = "1.0", features = ["derive"] }
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio"] }
local-utils = { path = "../local-utils" }
tracing_alias = { package = "tracing-subscriber", version = "0.3" }
remote-helper = { git = "https://github.com/example/remote-helper", branch = "main" }

[dev-dependencies]
pretty_assertions = "1"

[build-dependencies]
cc = "1"

[target.'cfg(unix)'.dependencies]
nix = "0.27"
`);
        const result = await scanCargoPackages(tmp);
        const byName = new Map(result.components.map((c) => [c.name, c]));
        expect(byName.get('axum')?.type).toBe('framework');
        expect(byName.get('axum')?.role.purpose).toContain('Axum');
        expect(byName.get('sqlx')?.type).toBe('database');
        expect(byName.get('local-utils')?.type).toBe('cargo');
        expect(byName.get('local-utils')?.metadata?.source_kind).toBe('path');
        expect(byName.get('local-utils')?.metadata?.source).toBe('../local-utils');
        expect(byName.get('tracing-subscriber')?.metadata?.crate_name).toBe('tracing_alias');
        expect(byName.get('remote-helper')?.repository_url).toBe('https://github.com/example/remote-helper');
        expect(byName.get('pretty_assertions')?.metadata?.dependency_kind).toBe('dev');
        expect(byName.get('pretty_assertions')?.role.critical).toBe(false);
        expect(byName.get('cc')?.metadata?.dependency_kind).toBe('build');
        expect(byName.get('nix')?.metadata?.dependency_kind).toBe('target');
        expect(byName.get('nix')?.metadata?.target).toBe("'cfg(unix)'");
    });
    it('resolves workspace dependency versions into member manifests', async () => {
        writeFixture('Cargo.toml', `
[workspace]
members = ["crates/*"]

[workspace.dependencies]
tokio = "1.37"
serde = { version = "1.0", features = ["derive"] }
`);
        writeFixture('crates/api/Cargo.toml', `
[package]
name = "api"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { workspace = true, features = ["rt-multi-thread", "macros"] }
serde = { workspace = true }
anyhow = "1"
`);
        const result = await scanCargoPackages(tmp);
        const byName = new Map(result.components.map((c) => [c.name, c]));
        expect(byName.get('tokio')?.version).toBe('1.37');
        expect(byName.get('tokio')?.type).toBe('framework');
        expect(byName.get('tokio')?.metadata?.source_kind).toBe('workspace');
        expect(byName.get('tokio')?.metadata?.features).toEqual(['rt-multi-thread', 'macros']);
        expect(byName.get('serde')?.version).toBe('1.0');
        expect(byName.get('anyhow')?.version).toBe('1');
    });
    it('uses Cargo.lock as a version fallback when the manifest omits one', async () => {
        writeFixture('Cargo.toml', `
[package]
name = "api"
version = "0.1.0"
edition = "2021"

[dependencies]
remote-helper = { git = "https://github.com/example/remote-helper" }
`);
        writeFixture('Cargo.lock', `
version = 3

[[package]]
name = "remote-helper"
version = "0.4.2"
source = "git+https://github.com/example/remote-helper#abc123"
`);
        const result = await scanCargoPackages(tmp);
        const remoteHelper = result.components.find((c) => c.name === 'remote-helper');
        expect(remoteHelper?.version).toBe('0.4.2');
        expect(remoteHelper?.metadata?.lock_source).toBe('git+https://github.com/example/remote-helper#abc123');
    });
    it('detects Cargo projects and integrates with the full scanner', async () => {
        writeFixture('Cargo.toml', `
[package]
name = "api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
`);
        writeFixture('src/main.rs', 'fn main() {}\n');
        expect(detectCargo(tmp)).toBe(true);
        const result = await scan(tmp, { mode: 'full', quick: true });
        const axum = result.components.find((c) => c.name === 'axum');
        expect(axum).toBeDefined();
        expect(axum?.tags).toContain('cargo');
        expect(result.stats.files_scanned).toBe(1);
    });
});
//# sourceMappingURL=cargo-packages.test.js.map