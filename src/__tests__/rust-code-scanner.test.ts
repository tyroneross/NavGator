/**
 * Tests for the Rust code scanner (modules, types, trait impls, use graph, LLM calls).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanRustCode, expandUseTree, stripRustNonCode } from '../scanners/rust/code-scanner.js';

let tmp: string;

function writeFixture(relPath: string, content: string): void {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-rust-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('scanRustCode', () => {
  it('detects modules, types, trait impls, internal imports, external crates, and LLM calls', async () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');

    writeFixture(
      'src/main.rs',
      [
        'mod config;',
        'pub mod handlers;',
        '',
        'use crate::config::Settings;',
        'use serde::Deserialize;',
        'use std::collections::HashMap;',
        '',
        'pub struct App {',
        '    settings: Settings,',
        '}',
        '',
        'fn call_model() {',
        '    let url = "https://api.anthropic.com/v1/messages";',
        '    let _ = reqwest::blocking::get(url);',
        '}',
      ].join('\n')
    );

    writeFixture(
      'src/config.rs',
      [
        '#[derive(Deserialize)]',
        'pub struct Settings {',
        '    pub name: String,',
        '}',
        '',
        'pub trait Loadable {',
        '    fn load(&self);',
        '}',
        '',
        'impl Loadable for Settings {',
        '    fn load(&self) {}',
        '}',
      ].join('\n')
    );

    const result = await scanRustCode(tmp);

    const names = result.components.map(c => c.name);
    // Types
    expect(names).toContain('App');
    expect(names).toContain('Settings');
    // Trait declared + used as conformance target
    expect(names).toContain('Loadable');
    // Modules are file nodes now, not name-keyed `mod:` components.
    expect(names.some(n => n.startsWith('mod:'))).toBe(false);
    // External crate (serde), but NOT std
    expect(names).toContain('serde');
    expect(names).not.toContain('std');
    // LLM provider from URL literal
    expect(names).toContain('Claude (Anthropic)');

    // conforms-to connection: Settings implements Loadable
    const conforms = result.connections.filter(c => c.connection_type === 'conforms-to');
    expect(conforms.some(c => (c.description ?? '').includes('Settings') && (c.description ?? '').includes('Loadable'))).toBe(true);

    // internal import (crate::config) → file-to-file imports edge
    const imports = result.connections.filter(c => c.connection_type === 'imports');
    expect(imports.some(c =>
      c.from.component_id === 'FILE:src/main.rs' &&
      c.to.component_id === 'FILE:src/config.rs' &&
      c.to.location?.file === 'src/config.rs'
    )).toBe(true);

    // external crate → uses-package
    const usesPkg = result.connections.filter(c => c.connection_type === 'uses-package');
    expect(usesPkg.some(c => c.code_reference.symbol?.includes('serde'))).toBe(true);

    // LLM URL → service-call
    const svc = result.connections.filter(c => c.connection_type === 'service-call');
    expect(svc.length).toBeGreaterThan(0);
  });

  it('ignores the Rust target/ build directory', async () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');
    writeFixture('src/lib.rs', 'pub struct RealType {}\n');
    writeFixture('target/debug/build/generated.rs', 'pub struct GeneratedArtifact {}\n');

    const result = await scanRustCode(tmp);
    const names = result.components.map(c => c.name);
    expect(names).toContain('RealType');
    expect(names).not.toContain('GeneratedArtifact');
  });

  it('respects the incremental walk-set', async () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');
    writeFixture('src/a.rs', 'pub struct AType {}\n');
    writeFixture('src/b.rs', 'pub struct BType {}\n');

    const result = await scanRustCode(tmp, new Set(['src/a.rs']));
    const names = result.components.map(c => c.name);
    expect(names).toContain('AType');
    expect(names).not.toContain('BType');
  });

  it('returns empty for a project with no .rs files', async () => {
    writeFixture('Cargo.toml', '[package]\nname = "empty"\nversion = "0.1.0"\n');
    const result = await scanRustCode(tmp);
    expect(result.components).toHaveLength(0);
    expect(result.connections).toHaveLength(0);
  });

  it('builds the module graph file-to-file from mod declarations and crate/super/self paths', async () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo-core"\nversion = "0.1.0"\n');
    writeFixture('src/lib.rs', 'pub mod store;\nmod util;\npub use crate::store::Store;\n');
    writeFixture('src/store/mod.rs', 'mod query;\nuse crate::{util::helper, store::query::Q};\npub struct Store;\n');
    writeFixture('src/store/query.rs', 'use super::Store;\npub struct Q;\nfn f() { crate::util::helper(); }\n');
    writeFixture('src/util.rs', '// crate::store::Store is mentioned only in a comment\npub fn helper() { let _s = "super::nothing"; }\n');
    writeFixture('tests/it.rs', 'use demo_core::Store;\n');

    const result = await scanRustCode(tmp, undefined, [
      { component_id: 'COMP_placeholder', crateName: 'unused_dep', manifest: 'Cargo.toml' },
    ]);
    const edges = result.connections
      .filter(c => c.from.component_id.startsWith('FILE:') && c.to.component_id.startsWith('FILE:'))
      .map(c => `${c.connection_type} ${c.from.component_id.slice(5)} -> ${c.to.component_id.slice(5)}`)
      .sort();

    expect(edges).toEqual([
      'imports src/lib.rs -> src/store/mod.rs',            // pub use crate::store::Store
      'imports src/store/mod.rs -> src/store/query.rs',    // grouped use crate::{.., store::query::Q}
      'imports src/store/mod.rs -> src/util.rs',           // grouped use crate::{util::helper, ..}
      'imports src/store/query.rs -> src/store/mod.rs',    // use super::Store
      'imports src/store/query.rs -> src/util.rs',         // inline crate::util::helper()
      'imports tests/it.rs -> src/lib.rs',                 // integration test uses its own crate
      'other src/lib.rs -> src/store/mod.rs',              // mod store;
      'other src/lib.rs -> src/util.rs',                   // mod util;
      'other src/store/mod.rs -> src/store/query.rs',      // mod query;
    ]);
  });

  it('resolves crate usage onto the declaring manifest node without minting ghost crates', async () => {
    writeFixture('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
    writeFixture('crates/daemon/Cargo.toml', '[package]\nname = "daemon"\nversion = "0.1.0"\n');
    writeFixture('crates/daemon/src/main.rs', [
      '#[tokio::main]',
      'async fn main() {',
      '    let _v = serde_json::json!({});',
      '    let _s = "tokio::fake_in_string";',
      '}',
    ].join('\n'));
    writeFixture('crates/store/Cargo.toml', '[package]\nname = "store"\nversion = "0.1.0"\n');
    writeFixture('crates/store/src/lib.rs', [
      'use rusqlite::Connection;',
      'use Kind::*; // a local enum glob, not a crate',
      'pub enum Kind { A }',
    ].join('\n'));

    const known = [
      { component_id: 'COMP_tokio_daemon', crateName: 'tokio', manifest: 'crates/daemon/Cargo.toml' },
      { component_id: 'COMP_serde_json_daemon', crateName: 'serde_json', manifest: 'crates/daemon/Cargo.toml' },
      { component_id: 'COMP_tokio_store', crateName: 'tokio', manifest: 'crates/store/Cargo.toml' },
      { component_id: 'COMP_rusqlite_store', crateName: 'rusqlite', manifest: 'crates/store/Cargo.toml' },
    ];
    const result = await scanRustCode(tmp, undefined, known);

    const usesPkg = result.connections
      .filter(c => c.connection_type === 'uses-package')
      .map(c => `${c.from.component_id} -> ${c.to.component_id}`)
      .sort();
    expect(usesPkg).toEqual([
      'FILE:crates/daemon/src/main.rs -> COMP_serde_json_daemon',
      'FILE:crates/daemon/src/main.rs -> COMP_tokio_daemon',
      'FILE:crates/store/src/lib.rs -> COMP_rusqlite_store',
    ]);
    // tokio declared in store but unused there keeps no edge (a real unused dep),
    // and no config-less duplicate crate node (or a `Kind` "crate") is minted.
    expect(result.components.filter(c => c.type === 'cargo')).toHaveLength(0);
  });

  it('expands grouped use trees and strips non-code text', () => {
    expect(expandUseTree('crate::{a::B, c::{d, e as f}, g::*}').sort())
      .toEqual(['crate::a::B', 'crate::c::d', 'crate::c::e', 'crate::g'].sort());
    const stripped = stripRustNonCode('let s = "tokio::x"; // serde::y\n/* a::b */ let r = r#"c::d"#; x::y');
    expect(stripped).not.toMatch(/tokio|serde|a::b|c::d/);
    expect(stripped).toContain('x::y');
    expect(stripped.split('\n')).toHaveLength(2);
  });

  it('links files to the types they use, within the crate, and ignores definitions and impl headers', async () => {
    writeFixture('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n');
    writeFixture('src/lib.rs', 'mod model;\nmod engine;\n');
    writeFixture('src/model.rs', [
      'pub struct Ledger { entries: Vec<Entry> }',
      'struct Entry;',                       // used in this file only
      'struct Unused;',                      // defined, impl-ed, never used
      'impl Unused { fn f(&self) {} }',
      'impl Default for Ledger { fn default() -> Self { Ledger { entries: vec![] } } }',
    ].join('\n'));
    writeFixture('src/engine.rs', [
      'use crate::model::Ledger;',
      '// Unused is only named in a comment',
      'pub fn run(l: &Ledger) -> &str { "Unused" }',
    ].join('\n'));

    const result = await scanRustCode(tmp);
    const byId = new Map(result.components.map(c => [c.component_id, c.name]));
    const refs = result.connections
      .filter(c => c.connection_type === 'references')
      .map(c => `${c.from.component_id.slice(5)} -> ${byId.get(c.to.component_id) ?? c.to.component_id}`)
      .sort();
    expect(refs).toEqual([
      'src/engine.rs -> Ledger',
      'src/model.rs -> Entry',
      'src/model.rs -> Ledger',
    ]);
    // Unused keeps no inbound use, so orphan-component can still report it.
    const unusedId = result.components.find(c => c.name === 'Unused')!.component_id;
    expect(result.connections.some(c => c.to.component_id === unusedId || c.from.component_id === unusedId)).toBe(false);
  });

  it('resolves a module declared inside an inline module, and types used from another crate', async () => {
    writeFixture('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
    writeFixture('crates/contracts/Cargo.toml', '[package]\nname = "contracts"\nversion = "0.1.0"\n');
    writeFixture('crates/contracts/src/lib.rs', 'pub enum ErrorCode { Bad }\n');
    writeFixture('crates/app/Cargo.toml', '[package]\nname = "app"\nversion = "0.1.0"\n');
    writeFixture('crates/app/src/lib.rs', [
      'mod surface {',
      '    #[cfg(test)]',
      '    mod tests;',
      '}',
      'pub fn f() -> contracts::ErrorCode { contracts::ErrorCode::Bad }',
    ].join('\n'));
    writeFixture('crates/app/src/surface/tests.rs', 'fn t() {}\n');

    const result = await scanRustCode(tmp);
    const byId = new Map(result.components.map(c => [c.component_id, c.name]));
    expect(result.connections.some(c =>
      c.connection_type === 'other' &&
      c.from.component_id === 'FILE:crates/app/src/lib.rs' &&
      c.to.component_id === 'FILE:crates/app/src/surface/tests.rs'
    )).toBe(true);
    expect(result.connections.some(c =>
      c.connection_type === 'references' &&
      c.from.component_id === 'FILE:crates/app/src/lib.rs' &&
      byId.get(c.to.component_id) === 'ErrorCode'
    )).toBe(true);
  });
});
