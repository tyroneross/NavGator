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
import { glob } from '../../sorted-glob.js';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  ProjectMetadata,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

interface RustFileInfo {
  relativePath: string;
  content: string;
  lines: string[];
}

type RustTypeKind = 'struct' | 'enum' | 'trait';

interface TypeDecl {
  name: string;
  kind: RustTypeKind;
  isPub: boolean;
  file: string;
  line: number;
}

interface ModuleDecl {
  name: string;
  isPub: boolean;
  inline: boolean; // `mod foo { }` vs `mod foo;`
  file: string;
  line: number;
  /** Enclosing inline modules, outermost first: `mod a { mod b; }` → ['a'] for b. */
  inlineParents: string[];
  /** `#[path = "x.rs"]` on the declaration, when present. */
  pathAttr?: string;
  /** Declared inside a `#[cfg(test)]` item (or is one), so it only exists in a test build. */
  testOnly: boolean;
}

interface TraitImpl {
  traitName: string;
  typeName: string;
  file: string;
  line: number;
  snippet: string;
}

interface UsePath {
  raw: string;      // e.g. "crate::config::Settings" or "serde::Deserialize"
  head: string;     // first segment: "crate", "self", "super", or a crate name
  file: string;
  line: number;
  /** An in-expression path (`super::helper()`), not a `use` declaration. */
  inline: boolean;
  /** Inside a `#[cfg(test)]` item, so it only exists in a test build. */
  testOnly: boolean;
}

/**
 * A Cargo dependency node from the package pass (Phase 1), so crate usage in
 * source can be resolved onto the node the manifest produced instead of
 * minting a second, config-less node for the same crate.
 */
export interface RustKnownPackage {
  component_id: string;
  /** The name code uses: the dependency key (`crate_name`), which may differ from the package name. */
  crateName: string;
  /** Repo-relative path of the Cargo.toml that declared it. */
  manifest: string;
}

/** One `[package]` crate: where it lives and what its own library is. */
interface CrateInfo {
  dir: string;        // repo-relative crate directory ('' for the scan root)
  manifest: string;   // repo-relative Cargo.toml path
  name: string;
  ident: string;      // name with '-' → '_', as source refers to it
  libFile?: string;   // repo-relative src/lib.rs when present
}

interface LLMApiCall {
  provider: string;
  file: string;
  line: number;
  symbol: string;
  snippet: string;
}

// External-path heads that are internal to the crate, never a package.
const INTERNAL_HEADS = new Set(['crate', 'self', 'super']);

// Standard library / language roots that are not third-party packages.
const STDLIB_HEADS = new Set(['std', 'core', 'alloc']);

// LLM provider detection — reqwest / HTTP client URL literals.
const LLM_URL_PATTERNS: { pattern: RegExp; provider: string }[] = [
  { pattern: /api\.anthropic\.com/, provider: 'Claude (Anthropic)' },
  { pattern: /api\.openai\.com/, provider: 'OpenAI' },
  { pattern: /generativelanguage\.googleapis\.com/, provider: 'Gemini (Google)' },
  { pattern: /api\.groq\.com/, provider: 'Groq' },
  { pattern: /api\.cohere\.ai/, provider: 'Cohere' },
  { pattern: /api\.mistral\.ai/, provider: 'Mistral' },
  { pattern: /api\.together\.xyz/, provider: 'Together AI' },
  { pattern: /api\.fireworks\.ai/, provider: 'Fireworks AI' },
  // The API path, not the bare host: `openrouter.ai/models` is a docs link.
  { pattern: /openrouter\.ai\/api\//, provider: 'OpenRouter' },
];

// LLM SDK crate imports (async-openai, anthropic-sdk, etc.).
const LLM_CRATE_PATTERNS: { pattern: RegExp; provider: string }[] = [
  { pattern: /^async[_-]openai$/, provider: 'OpenAI' },
  { pattern: /^openai[_-]api[_-]rust$/, provider: 'OpenAI' },
  { pattern: /^anthropic/, provider: 'Claude (Anthropic)' },
  { pattern: /^google[_-]generative[_-]ai/, provider: 'Gemini (Google)' },
  { pattern: /^ollama[_-]rs$/, provider: 'Ollama' },
];

// =============================================================================
// MAIN SCANNER
// =============================================================================

export async function scanRustCode(
  projectRoot: string,
  walkSet?: Set<string>,
  knownPackages?: RustKnownPackage[]
): Promise<ScanResult & { projectMeta: Partial<ProjectMetadata> }> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
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

  const files: RustFileInfo[] = [];
  for (const relPath of rustFiles) {
    try {
      const content = await fs.promises.readFile(path.join(projectRoot, relPath), 'utf-8');
      files.push({ relativePath: relPath, content, lines: content.split('\n') });
    } catch {
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
  const emitted = new Map<string, string>(); // `${type}:${name}` -> component_id
  const addComponent = (comp: ArchitectureComponent): string => {
    const key = `${comp.type}:${comp.name}`;
    const existing = emitted.get(key);
    if (existing) return existing;
    emitted.set(key, comp.component_id);
    components.push(comp);
    return comp.component_id;
  };
  /** Canonical id for an already-emitted component, or undefined. */
  const idFor = (type: string, name: string): string | undefined => emitted.get(`${type}:${name}`);

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
  //
  // Modules are represented by the files that hold them, not by a `mod:<name>`
  // component. The old `mod:<name>` node was keyed on the bare name across the
  // whole workspace (`mod tests`, `mod store` in every crate collapsed into one
  // node) and carried the DECLARING file, so an edge to it said nothing about
  // which file was coupled to which. Module structure is emitted below as
  // file → file edges instead (see the module-graph pass).
  const modules = scanModules(files);

  // ---- Trait implementations → conforms-to ----
  const impls = scanTraitImpls(files);
  const traitConformers = new Map<string, number>();
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
        purpose: `Rust trait ${impl.traitName} (${traitConformers.get(impl.traitName)} impl${traitConformers.get(impl.traitName)! > 1 ? 's' : ''})`,
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

  // ---- Module graph: `mod x;` + `use crate::/self::/super::` → file edges ----
  const crates = loadCrates(projectRoot, files.map(f => f.relativePath));
  const fileSet = new Set(allRustFiles);
  const fileEdgeSeen = new Map<string, ArchitectureConnection>();
  const pushFileEdge = (
    fromFile: string,
    toFile: string,
    line: number,
    kind: 'imports' | 'other',
    symbol: string,
    snippet: string,
    description: string,
    testOnly: boolean
  ): void => {
    if (fromFile === toFile) return;
    const key = `${kind}|${fromFile}|${toFile}`;
    const seen = fileEdgeSeen.get(key);
    if (seen) {
      // One edge per file pair. A runtime use anywhere in the file makes the
      // pair runtime coupling, whichever use was seen first.
      if (!testOnly && seen.runtime_relevance === 'test-only') delete seen.runtime_relevance;
      return;
    }
    const conn: ArchitectureConnection = {
      connection_id: generateConnectionId(kind),
      // FILE: on both ends so scanner.ts binds each end to that file's node.
      from: { component_id: `FILE:${fromFile}`, location: { file: fromFile, line } },
      to: { component_id: `FILE:${toFile}`, location: { file: toFile, line: 1 } },
      connection_type: kind,
      code_reference: {
        file: fromFile,
        symbol,
        symbol_type: 'import',
        line_start: line,
        code_snippet: snippet.slice(0, 100),
      },
      description,
      detected_from: 'rust-code-scanner',
      confidence: 0.85,
      timestamp,
      last_verified: timestamp,
      ...(testOnly ? { runtime_relevance: 'test-only' as const } : {}),
    };
    fileEdgeSeen.set(key, conn);
    connections.push(conn);
  };

  // A file declared by a test-only `mod x;` (`#[cfg(test)] mod tests;`) is
  // compiled only in a test build, and so is every module it declares.
  const testOnlyFiles = new Set<string>();
  const childOf = (m: ModuleDecl): string | undefined =>
    m.inline
      ? undefined
      : m.pathAttr
        ? resolvePathAttribute(m.file, m.inlineParents, m.pathAttr, fileSet)
        : resolveChildModuleFile(m.file, [...m.inlineParents, m.name].join('/'), fileSet);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of modules) {
      if (!m.testOnly && !testOnlyFiles.has(m.file)) continue;
      const child = childOf(m);
      if (child && !testOnlyFiles.has(child)) {
        testOnlyFiles.add(child);
        changed = true;
      }
    }
  }

  // `mod x;` — the parent file owns the child file. Typed `other`, not
  // `imports`: a child reaching back with `use super::X` is the normal Rust
  // module shape, and an `imports` edge here would report every such child as
  // an import cycle.
  for (const m of modules) {
    const child = childOf(m);
    if (!child) continue;
    const testOnly = m.testOnly || testOnlyFiles.has(m.file);
    pushFileEdge(m.file, child, m.line, 'other', `mod ${m.name}`, `mod ${m.name};`, `${m.file} declares module ${m.name}`, testOnly);
  }

  // Paths into the crate's own module tree (`use crate::a::B`, inline
  // `super::helper()`), resolved to the file that defines the module.
  const usePaths = scanUsePaths(files);
  for (const u of usePaths) {
    if (!INTERNAL_HEADS.has(u.head)) continue;
    const crate = crateForFile(u.file, crates);
    const target = resolveInternalPath(u.file, u.raw.split('::'), crate, fileSet);
    if (!target) continue;
    const testOnly = u.testOnly || testOnlyFiles.has(u.file);
    pushFileEdge(u.file, target, u.line, 'imports', u.raw, u.inline ? u.raw : `use ${u.raw}`, `${u.file} imports ${u.raw}`, testOnly);
  }

  // ---- External crate usage → uses-package ----
  //
  // With manifest data (a full scan: `knownPackages` holds the Phase 1 cargo
  // nodes), a crate is used when its identifier appears as a path head —
  // `use tokio::sync`, `tokio::spawn(..)`, `#[tokio::main]`,
  // `#[derive(serde::Serialize)]` — in a file of a crate whose Cargo.toml
  // declares it. The edge goes to THAT manifest's node, so per-crate
  // declarations stay separate and a dependency declared but never used in its
  // crate stays an orphan: that is a real finding. Without manifest data (a
  // direct call), fall back to the `use`-statement heuristic and mint a node.
  const externalCrates = new Set<string>();
  const haveManifestData = crates.length > 0 && (knownPackages?.length ?? 0) > 0;
  const depsByManifest = new Map<string, Map<string, string>>(); // manifest -> ident -> component_id
  for (const pkg of knownPackages ?? []) {
    const ident = pkg.crateName.replace(/-/g, '_');
    if (!depsByManifest.has(pkg.manifest)) depsByManifest.set(pkg.manifest, new Map());
    const byIdent = depsByManifest.get(pkg.manifest)!;
    if (!byIdent.has(ident)) byIdent.set(ident, pkg.component_id);
  }
  const packageEdgeSeen = new Set<string>();
  const pushPackageEdge = (file: string, line: number, targetCompId: string, crateIdent: string, snippet: string): void => {
    const key = `${file}|${targetCompId}`;
    if (packageEdgeSeen.has(key)) return;
    packageEdgeSeen.add(key);
    connections.push({
      connection_id: generateConnectionId('uses-package'),
      from: { component_id: `FILE:${file}`, location: { file, line } },
      to: { component_id: targetCompId },
      connection_type: 'uses-package',
      code_reference: {
        file,
        symbol: crateIdent,
        symbol_type: 'import',
        line_start: line,
        code_snippet: snippet.slice(0, 100),
      },
      description: `${file} uses crate ${crateIdent}`,
      detected_from: 'rust-code-scanner',
      confidence: 0.8,
      timestamp,
      last_verified: timestamp,
    });
  };

  if (haveManifestData) {
    for (const file of files) {
      const crate = crateForFile(file.relativePath, crates);
      if (!crate) continue;
      const deps = depsByManifest.get(crate.manifest);
      for (const hit of scanCrateHeads(file)) {
        // A crate's own tests/, benches/ and examples/ reach its library by
        // the crate's own name: that is an edge into src/lib.rs.
        if (hit.ident === crate.ident && crate.libFile) {
          pushFileEdge(file.relativePath, crate.libFile, hit.line, 'imports', hit.ident, hit.snippet, `${file.relativePath} uses its own crate ${crate.name}`, testOnlyFiles.has(file.relativePath));
          continue;
        }
        const compId = deps?.get(hit.ident);
        if (compId) pushPackageEdge(file.relativePath, hit.line, compId, hit.ident, hit.snippet);
      }
    }
  }

  for (const u of usePaths) {
    if (u.inline || INTERNAL_HEADS.has(u.head) || STDLIB_HEADS.has(u.head)) continue;
    const llmMatch = LLM_CRATE_PATTERNS.find(p => p.pattern.test(u.head));
    if (haveManifestData && !llmMatch) continue; // resolved against manifests above
    externalCrates.add(u.head);
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

  // ---- Type references → references ----
  //
  // A struct/enum/trait node had an edge only when something `impl`ed a
  // trait for it, so most Rust types read as orphans although the code
  // uses them. Resolve each CamelCase identifier against the declarations in
  // the same crate: a declaration in exactly one file of that crate is the
  // one a use means (the same name declared in two files of one crate is
  // skipped, not guessed). The edge runs from the using file to the type's
  // node when that node is this declaration, else to the declaring file.
  //
  // Uses inside the declaring file count too (a private helper type used
  // only where it is defined is used), except the declaration itself and
  // `impl ... for Name` / `impl Name` headers, which define the type rather
  // than use it.
  const declFilesByCrateName = new Map<string, Set<string>>(); // `${crateDir}|${name}` -> files
  const nodeFileByName = new Map<string, string>();             // first declaration = the emitted node
  const declFilesByName = new Map<string, Set<string>>();       // workspace-wide
  for (const t of typeDecls) {
    if (!declFilesByName.has(t.name)) declFilesByName.set(t.name, new Set());
    declFilesByName.get(t.name)!.add(t.file);
    const crate = crateForFile(t.file, crates);
    const key = `${crate?.dir ?? ''}|${t.name}`;
    if (!declFilesByCrateName.has(key)) declFilesByCrateName.set(key, new Set());
    declFilesByCrateName.get(key)!.add(t.file);
    if (!nodeFileByName.has(t.name)) nodeFileByName.set(t.name, t.file);
  }
  const nodeIdForType = (name: string): string | undefined =>
    idFor('component', name) ?? idFor('other', name);
  for (const file of files) {
    const crate = crateForFile(file.relativePath, crates);
    const seenTargets = new Set<string>();
    for (const ref of scanRustTypeUses(file)) {
      // Own crate first; a name the crate does not declare comes from a
      // dependency (`ambient_contracts::ErrorCode`), and resolves when exactly
      // one file in the workspace declares it.
      const declFiles =
        declFilesByCrateName.get(`${crate?.dir ?? ''}|${ref.name}`) ?? declFilesByName.get(ref.name);
      if (!declFiles) continue;
      // A file that declares the name uses its own declaration (two private
      // `StageRequest`s in two modules of one crate); otherwise it must be
      // unique.
      const declFile = declFiles.has(file.relativePath)
        ? file.relativePath
        : declFiles.size === 1 ? [...declFiles][0] : undefined;
      if (!declFile) continue;
      const nodeId = nodeFileByName.get(ref.name) === declFile ? nodeIdForType(ref.name) : undefined;
      if (!nodeId && declFile === file.relativePath) continue; // no node to attribute a same-file use to
      const target = nodeId ?? `FILE:${declFile}`;
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      connections.push({
        connection_id: generateConnectionId('references'),
        from: { component_id: `FILE:${file.relativePath}`, location: { file: file.relativePath, line: ref.line } },
        to: { component_id: target, location: { file: declFile, line: 1 } },
        connection_type: 'references',
        code_reference: {
          file: file.relativePath,
          symbol: ref.name,
          symbol_type: 'class',
          line_start: ref.line,
          code_snippet: (file.lines[ref.line - 1] ?? '').trim().slice(0, 100),
        },
        description: `${file.relativePath} uses ${ref.name} (declared in ${declFile})`,
        detected_from: 'rust-code-scanner',
        confidence: 0.8,
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

  const projectMeta: Partial<ProjectMetadata> = {
    type: 'rust-app',
  };

  return { components, connections, warnings, projectMeta };
}

// =============================================================================
// DETECTORS
// =============================================================================

function stripComment(line: string): string {
  // Strip a `//` line comment, but not the `//` inside a URL scheme (`https://`).
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') {
      return line.slice(0, i);
    }
  }
  return line;
}

function scanTypeDecls(files: RustFileInfo[]): TypeDecl[] {
  const decls: TypeDecl[] = [];
  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = stripComment(file.lines[i]);
      // pub struct Foo / struct Foo<T> / pub(crate) enum Bar / trait Baz
      const m = line.match(
        /^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/
      );
      if (m) {
        decls.push({
          name: m[3],
          kind: m[2] as RustTypeKind,
          isPub: !!m[1],
          file: file.relativePath,
          line: i + 1,
        });
      }
    }
  }
  return decls;
}

function scanModules(files: RustFileInfo[]): ModuleDecl[] {
  const mods: ModuleDecl[] = [];
  for (const file of files) {
    // Track inline `mod x { ... }` nesting by brace depth on comment- and
    // string-stripped text, so `mod a { mod b; }` resolves b to a/b.rs.
    const stripped = stripRustNonCode(file.content);
    const code = stripped.split('\n');
    const testSpans = findCfgTestSpans(stripped);
    const lineStarts: number[] = [];
    for (let i = 0, off = 0; i < code.length; i++) {
      lineStarts.push(off);
      off += code[i].length + 1;
    }
    const stack: Array<{ name: string; depth: number }> = [];
    let depth = 0;
    for (let i = 0; i < code.length; i++) {
      const line = code[i];
      const m = line.match(/^\s*(pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*([;{])/);
      if (m) {
        mods.push({
          name: m[2],
          isPub: !!m[1],
          inline: m[3] === '{',
          file: file.relativePath,
          line: i + 1,
          inlineParents: stack.map(e => e.name),
          pathAttr: findPathAttribute(file.lines, i),
          testOnly: inSpans(testSpans, lineStarts[i] + line.indexOf('mod')),
        });
      }
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === '{') {
          if (m && m[3] === '{' && k === line.indexOf('{', line.indexOf('mod'))) stack.push({ name: m[2], depth });
          depth++;
        } else if (ch === '}') {
          depth--;
          while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
        }
      }
    }
  }
  return mods;
}

function scanTraitImpls(files: RustFileInfo[]): TraitImpl[] {
  const impls: TraitImpl[] = [];
  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = stripComment(file.lines[i]);
      // impl<T> Trait for Type { — capture Trait and Type, ignore generics/lifetimes.
      const m = line.match(
        /^\s*impl(?:\s*<[^>]*>)?\s+([A-Za-z_][\w:]*)(?:\s*<[^>]*>)?\s+for\s+([A-Za-z_]\w*)/
      );
      if (m) {
        // Normalize a path trait (a::b::Trait) to its final segment.
        const traitName = m[1].split('::').pop() as string;
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

/**
 * Blank out comments and string/char literals, keeping every newline so line
 * numbers survive. Path heads inside a doc comment or a log string are not
 * usages.
 */
export function stripRustNonCode(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === '/' && next === '*') {
      // Rust block comments nest.
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; }
        else if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === 'r' && (next === '"' || next === '#') && !/[\w]/.test(src[i - 1] ?? '')) {
      const m = /^r(#*)"/.exec(src.slice(i, i + 260));
      if (!m) { out += c; i++; continue; }
      const close = `"${m[1]}`;
      let j = src.indexOf(close, i + m[0].length);
      j = j === -1 ? n : j + close.length;
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(n, j + 1);
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === "'") {
      const m = /^'(?:\\.[^']{0,8}|[^'\\\n])'/.exec(src.slice(i, i + 12));
      if (m) { out += blank(m[0]); i += m[0].length; }
      else { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * `#[cfg(test)]` — or `#[cfg(all(test, ...))]`, which also requires `test` —
 * on an item. `cfg(any(test, ...))` and `cfg(not(test))` are not test-only.
 */
const CFG_TEST_ATTR = /#\[\s*cfg\s*\(\s*(?:test|all\s*\([^()]*\btest\b[^()]*\))\s*\)\s*\]/g;

/**
 * Offset spans `[start, end)` of every item carrying a test-only `cfg`
 * attribute, on text already passed through `stripRustNonCode`. An item ends
 * at its first top-level `;` (`use`, `mod x;`) or at the brace that closes
 * its first top-level `{` (`mod tests { }`, `fn`, `impl`).
 */
export function findCfgTestSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  CFG_TEST_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CFG_TEST_ATTR.exec(code)) !== null) {
    const start = m.index;
    let i = m.index + m[0].length;
    const n = code.length;
    let end = n;
    let nest = 0; // ( and [ depth, so `[u8; 4]` does not end the item
    while (i < n) {
      const ch = code[i];
      if (ch === '(' || ch === '[') nest++;
      else if (ch === ')' || ch === ']') nest--;
      else if (ch === ';' && nest === 0) { end = i + 1; break; }
      else if (ch === '{' && nest === 0) {
        let depth = 0;
        let j = i;
        for (; j < n; j++) {
          if (code[j] === '{') depth++;
          else if (code[j] === '}' && --depth === 0) break;
        }
        end = Math.min(n, j + 1);
        break;
      }
      i++;
    }
    spans.push([start, end]);
    CFG_TEST_ATTR.lastIndex = Math.max(CFG_TEST_ATTR.lastIndex, end);
  }
  return spans;
}

function inSpans(spans: Array<[number, number]>, offset: number): boolean {
  return spans.some(([a, b]) => offset >= a && offset < b);
}

/**
 * Expand one `use` tree body (`a::{b, c::{d, e}}`, `x as y`, `a::*`) into
 * its leaf paths. Aliases and globs keep the path up to the alias/glob.
 */
export function expandUseTree(body: string): string[] {
  const text = body.replace(/\s+/g, '');
  const out: string[] = [];
  const walk = (prefix: string, tree: string): void => {
    // Split `tree` on top-level commas.
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of tree) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur) parts.push(cur);
    for (const part of parts) {
      const brace = part.indexOf('{');
      if (brace >= 0 && part.endsWith('}')) {
        const head = part.slice(0, brace).replace(/::$/, '');
        walk(prefix && head ? `${prefix}::${head}` : prefix || head, part.slice(brace + 1, -1));
        continue;
      }
      const leaf = part.replace(/as\w+$/, '').replace(/::\*$/, '').replace(/^\*$/, '');
      const full = prefix && leaf ? `${prefix}::${leaf}` : prefix || leaf;
      if (full && full !== 'self') out.push(full.replace(/::self$/, ''));
    }
  };
  walk('', text.replace(/^::/, ''));
  return out;
}

function scanUsePaths(files: RustFileInfo[]): UsePath[] {
  const uses: UsePath[] = [];
  for (const file of files) {
    const code = stripRustNonCode(file.content);
    const lineAt = lineIndexer(code);
    const testSpans = findCfgTestSpans(code);
    // `use` declarations, including multi-line and grouped trees.
    const useRe = /(^|[;{}\s])(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/g;
    const useSpans: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    while ((m = useRe.exec(code)) !== null) {
      const start = m.index + m[1].length;
      useSpans.push([start, m.index + m[0].length]);
      const line = lineAt(start);
      for (const raw of expandUseTree(m[2])) {
        const head = raw.split('::')[0];
        if (!head || !/^[A-Za-z_]\w*$/.test(head)) continue;
        uses.push({ raw, head, file: file.relativePath, line, inline: false, testOnly: inSpans(testSpans, start) });
      }
    }
    // In-expression paths into the crate's own module tree:
    // `crate::store::open()`, `super::helper(x)`, `self::inner::f()`.
    const inlineRe = /(?<![\w:])((?:crate|super|self)(?:::[A-Za-z_]\w*)+)/g;
    while ((m = inlineRe.exec(code)) !== null) {
      const at = m.index;
      if (useSpans.some(([a, b]) => at >= a && at < b)) continue;
      const raw = m[1];
      uses.push({ raw, head: raw.split('::')[0], file: file.relativePath, line: lineAt(at), inline: true, testOnly: inSpans(testSpans, at) });
    }
  }
  return uses;
}

/**
 * CamelCase identifiers USED in a file, with their first line. Declarations
 * (`struct Foo`, `enum Foo`, `trait Foo`, `type Foo`) and impl headers
 * (`impl<T> Trait for Foo<T>`) are blanked first: they define a type, they
 * do not use it.
 */
function scanRustTypeUses(file: RustFileInfo): Array<{ name: string; line: number }> {
  let code = stripRustNonCode(file.content);
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  code = code.replace(/\b(?:struct|enum|trait|type|union)\s+[A-Za-z_]\w*/g, blank);
  code = code.replace(/\bimpl\b[^{;]*[{;]/g, blank);
  const lines = code.split('\n');
  const first = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const re = /(?<![\w.'$])([A-Z][A-Za-z0-9_]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      if (!first.has(m[1])) first.set(m[1], i + 1);
    }
  }
  return [...first.entries()].map(([name, line]) => ({ name, line }));
}

/** Offset → 1-based line number, for a string whose newlines were preserved. */
function lineIndexer(text: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Every lowercase path head in a file (`tokio::spawn`, `use serde::X`,
 * `#[tokio::main]`, `extern crate libc`) with its first line. Callers filter
 * against the crate's declared dependencies, so local module heads and `std`
 * fall out there.
 */
function scanCrateHeads(file: RustFileInfo): Array<{ ident: string; line: number; snippet: string }> {
  const code = stripRustNonCode(file.content);
  const lineAt = lineIndexer(code);
  const first = new Map<string, number>();
  const note = (ident: string, offset: number): void => {
    if (!first.has(ident)) first.set(ident, offset);
  };
  let m: RegExpExecArray | null;
  const headRe = /(?<![\w:$])([a-z_][a-z0-9_]*)\s*::/g;
  while ((m = headRe.exec(code)) !== null) note(m[1], m.index);
  const bareRe = /\b(?:use|extern\s+crate)\s+([a-z_][a-z0-9_]*)\s*(?:;|\bas\b)/g;
  while ((m = bareRe.exec(code)) !== null) note(m[1], m.index);
  return [...first.entries()].map(([ident, offset]) => {
    const line = lineAt(offset);
    return { ident, line, snippet: (file.lines[line - 1] ?? '').trim() };
  });
}

/** Read every `[package]` Cargo.toml that owns one of `rustFiles`. */
function loadCrates(projectRoot: string, rustFiles: string[]): CrateInfo[] {
  const dirs = new Set<string>();
  for (const f of rustFiles) {
    let dir = path.posix.dirname(f);
    // Walk up to the nearest Cargo.toml.
    for (;;) {
      const manifest = dir === '.' ? 'Cargo.toml' : `${dir}/Cargo.toml`;
      if (dirs.has(dir)) break;
      if (fs.existsSync(path.join(projectRoot, manifest))) { dirs.add(dir); break; }
      if (dir === '.' || dir === '') break;
      dir = path.posix.dirname(dir);
    }
  }
  const crates: CrateInfo[] = [];
  for (const dir of dirs) {
    const rel = dir === '.' ? '' : dir;
    const manifest = rel ? `${rel}/Cargo.toml` : 'Cargo.toml';
    let text = '';
    try { text = fs.readFileSync(path.join(projectRoot, manifest), 'utf-8'); } catch { continue; }
    const pkg = /^\s*\[package\]([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(text);
    const name = pkg && /^\s*name\s*=\s*"([^"]+)"/m.exec(pkg[1])?.[1];
    if (!name) continue; // a virtual workspace manifest owns no source
    const libRel = rel ? `${rel}/src/lib.rs` : 'src/lib.rs';
    crates.push({
      dir: rel,
      manifest,
      name,
      ident: name.replace(/-/g, '_'),
      libFile: fs.existsSync(path.join(projectRoot, libRel)) ? libRel : undefined,
    });
  }
  return crates;
}

function crateForFile(file: string, crates: CrateInfo[]): CrateInfo | undefined {
  let best: CrateInfo | undefined;
  for (const c of crates) {
    if (c.dir === '' || file.startsWith(`${c.dir}/`)) {
      if (!best || c.dir.length > best.dir.length) best = c;
    }
  }
  return best;
}

/** A file that roots its own module tree (lib.rs, main.rs, bin/*, tests/*, build.rs...). */
function isCrateRootFile(file: string, crate: CrateInfo | undefined): boolean {
  const rel = crate && crate.dir ? file.slice(crate.dir.length + 1) : file;
  return /^(src\/(lib|main)\.rs|build\.rs|src\/bin\/[^/]+\.rs|src\/bin\/[^/]+\/main\.rs|(tests|benches|examples)\/[^/]+\.rs|(tests|benches|examples)\/[^/]+\/main\.rs)$/.test(rel);
}

/** Directory that holds the child modules of `file`. */
function moduleDirOf(file: string, crate: CrateInfo | undefined): string {
  const dir = path.posix.dirname(file);
  if (isCrateRootFile(file, crate) || path.posix.basename(file) === 'mod.rs') return dir;
  return `${dir}/${path.posix.basename(file, '.rs')}`;
}

function joinDir(dir: string, name: string): string {
  return dir === '.' || dir === '' ? name : `${dir}/${name}`;
}

/** `mod name;` declared in `parent` → the file holding module `name`. */
function resolveChildModuleFile(parent: string, name: string, fileSet: Set<string>): string | undefined {
  // Crate context only changes which directory children live in, and the
  // crate-root check needs it; derive it from the path shape alone here.
  const crateLike: CrateInfo | undefined = (() => {
    const idx = parent.lastIndexOf('/src/');
    if (idx >= 0) return { dir: parent.slice(0, idx), manifest: '', name: '', ident: '' };
    if (parent.startsWith('src/')) return { dir: '', manifest: '', name: '', ident: '' };
    const t = /^(.*?\/)?(tests|benches|examples)\//.exec(parent);
    if (t) return { dir: (t[1] ?? '').replace(/\/$/, ''), manifest: '', name: '', ident: '' };
    return undefined;
  })();
  const dir = moduleDirOf(parent, crateLike);
  for (const candidate of [joinDir(dir, `${name}.rs`), joinDir(dir, `${name}/mod.rs`)]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return undefined;
}

/** `#[path = "x.rs"]` within the attribute lines directly above line `i`. */
function findPathAttribute(lines: string[], i: number): string | undefined {
  for (let j = i; j >= Math.max(0, i - 4); j--) {
    const text = lines[j] ?? '';
    const m = text.match(/#\[\s*path\s*=\s*"([^"]+)"\s*\]/);
    if (m) return m[1];
    if (j < i && !/^\s*(#\[|\/\/|$)/.test(text)) break; // stop at the previous item
  }
  return undefined;
}

/**
 * Resolve `#[path]`. Outside any inline module the path is relative to the
 * declaring file's directory; inside `mod a { .. }` it is relative to the
 * directory that inline module's children would live in.
 */
function resolvePathAttribute(
  parent: string,
  inlineParents: string[],
  attr: string,
  fileSet: Set<string>
): string | undefined {
  let base = path.posix.dirname(parent);
  if (inlineParents.length > 0) {
    const crateLike: CrateInfo | undefined = parent.includes('/src/') || parent.startsWith('src/')
      ? { dir: parent.includes('/src/') ? parent.slice(0, parent.lastIndexOf('/src/')) : '', manifest: '', name: '', ident: '' }
      : undefined;
    base = joinDir(moduleDirOf(parent, crateLike), inlineParents.join('/'));
  }
  const candidate = path.posix.normalize(joinDir(base, attr));
  return fileSet.has(candidate) ? candidate : undefined;
}

/** The module file whose children live in `dir`. */
function moduleFileForDir(dir: string, fileSet: Set<string>): string | undefined {
  for (const candidate of [joinDir(dir, 'mod.rs'), `${dir}.rs`, joinDir(dir, 'lib.rs'), joinDir(dir, 'main.rs')]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolve a `crate::` / `self::` / `super::` path to the deepest module FILE
 * it names. Item segments past the last module (`crate::store::Store`) are
 * ignored: the edge is file-to-file.
 */
function resolveInternalPath(
  file: string,
  segments: string[],
  crate: CrateInfo | undefined,
  fileSet: Set<string>
): string | undefined {
  let dir: string;
  let current: string | undefined;
  let i = 0;
  if (segments[0] === 'crate') {
    if (!crate) return undefined;
    dir = joinDir(crate.dir, 'src');
    current = moduleFileForDir(dir, fileSet);
    i = 1;
  } else if (segments[0] === 'self' || segments[0] === 'super') {
    dir = moduleDirOf(file, crate);
    current = file;
    while (segments[i] === 'self') i++;
    while (segments[i] === 'super') {
      // `dir` holds the current module's children; its parent directory holds
      // the parent module's children (src/a/b.rs → src/a → src/a.rs|mod.rs).
      if (!current || isCrateRootFile(current, crate)) return undefined; // no parent module
      dir = path.posix.dirname(dir);
      current = moduleFileForDir(dir, fileSet);
      i++;
    }
  } else {
    return undefined;
  }
  for (; i < segments.length; i++) {
    const seg = segments[i];
    const next = [joinDir(dir, `${seg}.rs`), joinDir(dir, `${seg}/mod.rs`)].find(c => fileSet.has(c));
    if (!next) break;
    current = next;
    dir = joinDir(dir, seg);
  }
  return current;
}

function scanLLMCalls(files: RustFileInfo[]): LLMApiCall[] {
  const calls: LLMApiCall[] = [];
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
  const seen = new Set<string>();
  return calls.filter(c => {
    const key = `${c.file}:${c.provider}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractNearestFn(lines: string[], lineIndex: number): string | undefined {
  for (let j = lineIndex; j >= Math.max(0, lineIndex - 8); j--) {
    const m = lines[j].match(/\bfn\s+([A-Za-z_]\w*)/);
    if (m) return m[1];
  }
  return undefined;
}
