/**
 * Rust Code Scanner
 * Builds the navigable architecture of a Rust crate from .rs source:
 * - Modules (`mod foo;`, `pub mod foo { .. }`) → module components
 * - Types (`struct`, `enum`, `trait`) → type components
 * - Trait impls (`impl Trait for Type`) → conforms-to connections
 * - `use` paths → imports (internal crate/self/super) or uses-package (external crate)
 * - LLM API calls (reqwest/HTTP to known providers) → service-call connections
 *
 * Regex/line-based (no rustc) — mirrors the Swift code-scanner contract so the
 * output merges into the same component/connection graph.
 */
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { generateComponentId, generateConnectionId, } from '../../types.js';
// External-path heads that are internal to the crate, never a package.
const INTERNAL_HEADS = new Set(['crate', 'self', 'super']);
// Standard library / language roots that are not third-party packages.
const STDLIB_HEADS = new Set(['std', 'core', 'alloc']);
// LLM provider detection — reqwest / HTTP client URL literals.
const LLM_URL_PATTERNS = [
    { pattern: /api\.anthropic\.com/, provider: 'Claude (Anthropic)' },
    { pattern: /api\.openai\.com/, provider: 'OpenAI' },
    { pattern: /generativelanguage\.googleapis\.com/, provider: 'Gemini (Google)' },
    { pattern: /api\.groq\.com/, provider: 'Groq' },
    { pattern: /api\.cohere\.ai/, provider: 'Cohere' },
    { pattern: /api\.mistral\.ai/, provider: 'Mistral' },
    { pattern: /api\.together\.xyz/, provider: 'Together AI' },
    { pattern: /api\.fireworks\.ai/, provider: 'Fireworks AI' },
];
// LLM SDK crate imports (async-openai, anthropic-sdk, etc.).
const LLM_CRATE_PATTERNS = [
    { pattern: /^async[_-]openai$/, provider: 'OpenAI' },
    { pattern: /^openai[_-]api[_-]rust$/, provider: 'OpenAI' },
    { pattern: /^anthropic/, provider: 'Claude (Anthropic)' },
    { pattern: /^google[_-]generative[_-]ai/, provider: 'Gemini (Google)' },
    { pattern: /^ollama[_-]rs$/, provider: 'Ollama' },
];
// =============================================================================
// MAIN SCANNER
// =============================================================================
export async function scanRustCode(projectRoot, walkSet) {
    const components = [];
    const connections = [];
    const warnings = [];
    const timestamp = Date.now();
    const allRustFiles = await glob('**/*.rs', {
        cwd: projectRoot,
        ignore: [
            'target/**',
            '**/target/**',
            '**/.navgator/**',
            '**/.rally/**',
            '**/.build-loop/**',
            '**/.claude/**',
            '**/.codex/**',
            '**/.ibr/**',
            'build/**',
            '**/build/**',
            'build-*/**',
            '**/build-*/**',
            'vendor/**',
            '**/vendor/**',
        ],
    });
    // Walk-set restriction (incremental). Bit-identical when undefined.
    const rustFiles = walkSet ? allRustFiles.filter(f => walkSet.has(f)) : allRustFiles;
    const files = [];
    for (const relPath of rustFiles) {
        try {
            const content = await fs.promises.readFile(path.join(projectRoot, relPath), 'utf-8');
            files.push({ relativePath: relPath, content, lines: content.split('\n') });
        }
        catch {
            // skip unreadable
        }
    }
    if (files.length === 0) {
        return { components, connections, warnings, projectMeta: {} };
    }
    // Track which component ids we've already emitted (dedupe by name+type).
    //
    // addComponent RETURNS the canonical id. Callers must use the return value,
    // never the `component_id` they passed in: on the second call for the same
    // type+name the passed id is a fresh `generateComponentId()` (random suffix,
    // types.ts:725-729) that is discarded here, so an edge built from it named a
    // component that does not exist. Every repeat trait impl produced exactly
    // that dangling `conforms-to` edge.
    const emitted = new Map(); // `${type}:${name}` -> component_id
    const addComponent = (comp) => {
        const key = `${comp.type}:${comp.name}`;
        const existing = emitted.get(key);
        if (existing)
            return existing;
        emitted.set(key, comp.component_id);
        components.push(comp);
        return comp.component_id;
    };
    /** Canonical id for an already-emitted component, or undefined. */
    const idFor = (type, name) => emitted.get(`${type}:${name}`);
    // ---- Type declarations (struct / enum / trait) ----
    const typeDecls = scanTypeDecls(files);
    for (const t of typeDecls) {
        const compType = t.kind === 'trait' ? 'other' : 'component';
        addComponent({
            component_id: generateComponentId(compType, t.name),
            name: t.name,
            type: compType,
            role: {
                purpose: `Rust ${t.kind}: ${t.name}`,
                layer: 'backend',
                critical: false,
            },
            source: { detection_method: 'auto', config_files: [], confidence: 0.9 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['rust', t.kind, t.isPub ? 'public' : 'private'],
            metadata: { kind: t.kind, file: t.file, line: t.line, visibility: t.isPub ? 'pub' : 'private' },
            timestamp,
            last_updated: timestamp,
        });
    }
    // ---- Modules ----
    const modules = scanModules(files);
    for (const m of modules) {
        addComponent({
            component_id: generateComponentId('other', `mod:${m.name}`),
            name: `mod:${m.name}`,
            type: 'other',
            role: {
                purpose: `Rust module: ${m.name}`,
                layer: 'backend',
                critical: false,
            },
            source: { detection_method: 'auto', config_files: [], confidence: 0.85 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['rust', 'module', m.isPub ? 'public' : 'private', m.inline ? 'inline' : 'file'],
            metadata: { file: m.file, line: m.line, inline: m.inline },
            timestamp,
            last_updated: timestamp,
        });
    }
    // ---- Trait implementations → conforms-to ----
    const impls = scanTraitImpls(files);
    const traitConformers = new Map();
    for (const impl of impls) {
        traitConformers.set(impl.traitName, (traitConformers.get(impl.traitName) || 0) + 1);
    }
    for (const impl of impls) {
        // Ensure the trait exists as a component (external traits like Serialize won't
        // have a local declaration but are still meaningful conformance targets).
        const traitCompId = addComponent({
            component_id: generateComponentId('other', impl.traitName),
            name: impl.traitName,
            type: 'other',
            role: {
                purpose: `Rust trait ${impl.traitName} (${traitConformers.get(impl.traitName)} impl${traitConformers.get(impl.traitName) > 1 ? 's' : ''})`,
                layer: 'backend',
                critical: (traitConformers.get(impl.traitName) || 0) > 2,
            },
            source: { detection_method: 'auto', config_files: [], confidence: 0.8 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['rust', 'trait'],
            timestamp,
            last_updated: timestamp,
        });
        // Resolve (don't regenerate) the implementing type. The type-decl pass
        // above already emitted most of these; `impl Trait for Foo` where Foo is
        // declared in another crate or behind a macro is the exception, so create
        // it here rather than leaving the edge's source dangling.
        const implCompId = idFor('component', impl.typeName) ?? addComponent({
            component_id: generateComponentId('component', impl.typeName),
            name: impl.typeName,
            type: 'component',
            role: { purpose: `Rust type: ${impl.typeName}`, layer: 'backend', critical: false },
            source: { detection_method: 'auto', config_files: [], confidence: 0.75 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['rust', 'type', 'trait-impl'],
            metadata: { file: impl.file, line: impl.line },
            timestamp,
            last_updated: timestamp,
        });
        connections.push({
            connection_id: generateConnectionId('conforms-to'),
            from: {
                component_id: implCompId,
                location: { file: impl.file, line: impl.line },
            },
            to: { component_id: traitCompId },
            connection_type: 'conforms-to',
            code_reference: {
                file: impl.file,
                symbol: impl.typeName,
                symbol_type: 'class',
                line_start: impl.line,
                code_snippet: impl.snippet.slice(0, 100),
            },
            description: `${impl.typeName} implements ${impl.traitName}`,
            detected_from: 'rust-code-scanner',
            confidence: 0.85,
            timestamp,
            last_verified: timestamp,
        });
    }
    // ---- use paths → imports (internal) / uses-package (external crate) ----
    const usePaths = scanUsePaths(files);
    const externalCrates = new Set();
    for (const u of usePaths) {
        if (INTERNAL_HEADS.has(u.head)) {
            // Internal module reference — imports connection to the target module.
            const targetSegs = u.raw.split('::').filter(s => s && !INTERNAL_HEADS.has(s));
            const targetName = targetSegs[0];
            if (!targetName)
                continue;
            // Target: resolve the module component the module pass emitted. Calling
            // generateComponentId() again here produced a different random suffix, so
            // the edge pointed at a `mod:` id no component carried. If the module was
            // never declared locally (a re-export, or `crate::` reaching a path this
            // scan did not walk), skip rather than invent a component for it.
            const targetModId = idFor('other', `mod:${targetName}`);
            if (!targetModId)
                continue;
            connections.push({
                connection_id: generateConnectionId('imports'),
                // FILE: form so scanner.ts's endpoint resolver binds this to the
                // file's component — no `file:` component is ever pushed here, so the
                // generated id was never a real endpoint.
                from: {
                    component_id: `FILE:${u.file}`,
                    location: { file: u.file, line: u.line },
                },
                to: { component_id: targetModId },
                connection_type: 'imports',
                code_reference: {
                    file: u.file,
                    symbol: u.raw,
                    symbol_type: 'import',
                    line_start: u.line,
                    code_snippet: `use ${u.raw}`,
                },
                description: `${u.file} imports ${u.raw}`,
                detected_from: 'rust-code-scanner',
                confidence: 0.8,
                timestamp,
                last_verified: timestamp,
            });
        }
        else if (!STDLIB_HEADS.has(u.head)) {
            // External crate dependency.
            externalCrates.add(u.head);
            // LLM SDK crate?
            const llmMatch = LLM_CRATE_PATTERNS.find(p => p.pattern.test(u.head));
            const targetType = llmMatch ? 'llm' : 'cargo';
            const targetName = llmMatch ? llmMatch.provider : u.head;
            // Use addComponent's return: on the 2nd+ use of the same crate the id
            // generated here is discarded by the dedupe, so an edge built from it
            // would dangle.
            const targetCompId = addComponent({
                component_id: generateComponentId(targetType, targetName),
                name: targetName,
                type: targetType,
                role: {
                    purpose: llmMatch ? `${targetName} LLM SDK` : `Rust crate: ${u.head}`,
                    layer: 'external',
                    critical: !!llmMatch,
                },
                source: { detection_method: 'auto', config_files: [], confidence: 0.75 },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: llmMatch ? ['rust', 'llm', 'external'] : ['rust', 'crate', 'external'],
                timestamp,
                last_updated: timestamp,
            });
            connections.push({
                connection_id: generateConnectionId(llmMatch ? 'service-call' : 'uses-package'),
                from: {
                    component_id: `FILE:${u.file}`,
                    location: { file: u.file, line: u.line },
                },
                to: { component_id: targetCompId },
                connection_type: llmMatch ? 'service-call' : 'uses-package',
                code_reference: {
                    file: u.file,
                    symbol: u.raw,
                    symbol_type: 'import',
                    line_start: u.line,
                    code_snippet: `use ${u.raw}`,
                },
                description: `${u.file} uses crate ${u.head}`,
                detected_from: 'rust-code-scanner',
                confidence: 0.75,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- LLM API calls (URL literals) → service-call ----
    const llmCalls = scanLLMCalls(files);
    for (const call of llmCalls) {
        // Same as above — the 2nd+ call to the same provider must reuse the
        // canonical id addComponent returns, not the freshly generated one.
        const compId = addComponent({
            component_id: generateComponentId('llm', call.provider),
            name: call.provider,
            type: 'llm',
            role: { purpose: `${call.provider} LLM API`, layer: 'external', critical: true },
            source: { detection_method: 'auto', config_files: [], confidence: 0.9 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['rust', 'llm', 'external'],
            timestamp,
            last_updated: timestamp,
        });
        connections.push({
            connection_id: generateConnectionId('service-call'),
            from: {
                component_id: `FILE:${call.file}`,
                location: { file: call.file, line: call.line },
            },
            to: { component_id: compId },
            connection_type: 'service-call',
            code_reference: {
                file: call.file,
                symbol: call.symbol,
                symbol_type: 'function',
                line_start: call.line,
                code_snippet: call.snippet.slice(0, 100),
            },
            description: `${call.provider} API call in ${call.file}`,
            detected_from: 'rust-code-scanner',
            confidence: 0.9,
            timestamp,
            last_verified: timestamp,
        });
    }
    const projectMeta = {
        type: 'rust-app',
    };
    return { components, connections, warnings, projectMeta };
}
// =============================================================================
// DETECTORS
// =============================================================================
function stripComment(line) {
    // Strip a `//` line comment, but not the `//` inside a URL scheme (`https://`).
    for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') {
            return line.slice(0, i);
        }
    }
    return line;
}
function scanTypeDecls(files) {
    const decls = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = stripComment(file.lines[i]);
            // pub struct Foo / struct Foo<T> / pub(crate) enum Bar / trait Baz
            const m = line.match(/^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/);
            if (m) {
                decls.push({
                    name: m[3],
                    kind: m[2],
                    isPub: !!m[1],
                    file: file.relativePath,
                    line: i + 1,
                });
            }
        }
    }
    return decls;
}
function scanModules(files) {
    const mods = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = stripComment(file.lines[i]);
            const m = line.match(/^\s*(pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*([;{])/);
            if (m) {
                mods.push({
                    name: m[2],
                    isPub: !!m[1],
                    inline: m[3] === '{',
                    file: file.relativePath,
                    line: i + 1,
                });
            }
        }
    }
    return mods;
}
function scanTraitImpls(files) {
    const impls = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = stripComment(file.lines[i]);
            // impl<T> Trait for Type { — capture Trait and Type, ignore generics/lifetimes.
            const m = line.match(/^\s*impl(?:\s*<[^>]*>)?\s+([A-Za-z_][\w:]*)(?:\s*<[^>]*>)?\s+for\s+([A-Za-z_]\w*)/);
            if (m) {
                // Normalize a path trait (a::b::Trait) to its final segment.
                const traitName = m[1].split('::').pop();
                impls.push({
                    traitName,
                    typeName: m[2],
                    file: file.relativePath,
                    line: i + 1,
                    snippet: line.trim(),
                });
            }
        }
    }
    return impls;
}
function scanUsePaths(files) {
    const uses = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = stripComment(file.lines[i]);
            const m = line.match(/^\s*(?:pub\s+)?use\s+([A-Za-z_][\w:]*)/);
            if (m) {
                const raw = m[1];
                const head = raw.split('::')[0];
                if (!head)
                    continue;
                uses.push({ raw, head, file: file.relativePath, line: i + 1 });
            }
        }
    }
    return uses;
}
function scanLLMCalls(files) {
    const calls = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = stripComment(file.lines[i]);
            for (const { pattern, provider } of LLM_URL_PATTERNS) {
                if (pattern.test(line)) {
                    calls.push({
                        provider,
                        file: file.relativePath,
                        line: i + 1,
                        symbol: extractNearestFn(file.lines, i) || 'http_call',
                        snippet: line.trim(),
                    });
                }
            }
        }
    }
    // Dedupe by file+provider (keep first).
    const seen = new Set();
    return calls.filter(c => {
        const key = `${c.file}:${c.provider}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function extractNearestFn(lines, lineIndex) {
    for (let j = lineIndex; j >= Math.max(0, lineIndex - 8); j--) {
        const m = lines[j].match(/\bfn\s+([A-Za-z_]\w*)/);
        if (m)
            return m[1];
    }
    return undefined;
}
//# sourceMappingURL=code-scanner.js.map