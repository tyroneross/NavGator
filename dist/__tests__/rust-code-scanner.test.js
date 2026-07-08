/**
 * Tests for the Rust code scanner (modules, types, trait impls, use graph, LLM calls).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanRustCode } from '../scanners/rust/code-scanner.js';
let tmp;
function writeFixture(relPath, content) {
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
        writeFixture('src/main.rs', [
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
        ].join('\n'));
        writeFixture('src/config.rs', [
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
        ].join('\n'));
        const result = await scanRustCode(tmp);
        const names = result.components.map(c => c.name);
        // Types
        expect(names).toContain('App');
        expect(names).toContain('Settings');
        // Trait declared + used as conformance target
        expect(names).toContain('Loadable');
        // Modules
        expect(names).toContain('mod:config');
        expect(names).toContain('mod:handlers');
        // External crate (serde), but NOT std
        expect(names).toContain('serde');
        expect(names).not.toContain('std');
        // LLM provider from URL literal
        expect(names).toContain('Claude (Anthropic)');
        // conforms-to connection: Settings implements Loadable
        const conforms = result.connections.filter(c => c.connection_type === 'conforms-to');
        expect(conforms.some(c => (c.description ?? '').includes('Settings') && (c.description ?? '').includes('Loadable'))).toBe(true);
        // internal import (crate::config) → imports connection to mod:config
        const imports = result.connections.filter(c => c.connection_type === 'imports');
        expect(imports.some(c => c.code_reference.symbol?.includes('config'))).toBe(true);
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
});
//# sourceMappingURL=rust-code-scanner.test.js.map