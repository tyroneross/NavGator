/**
 * Swift Code Scanner
 * Detects runtime connections in .swift files:
 * - String-keyed deps (UserDefaults, @AppStorage, NotificationCenter, asset names)
 * - Protocol conformance
 * - State observation (@Published, @Observable, @EnvironmentObject)
 * - URLSession calls to LLM APIs
 * - Entitlement requirements from framework usage
 */
import * as fs from 'fs';
import * as path from 'path';
import { glob } from '../../sorted-glob.js';
import { generateComponentId, generateConnectionId, } from '../../types.js';
import { scanSwiftUIViews } from './swiftui-scanner.js';
// =============================================================================
// FRAMEWORK → ENTITLEMENT MAP
// =============================================================================
const FRAMEWORK_ENTITLEMENTS = {
    'HealthKit': { entitlement: 'com.apple.developer.healthkit', plistKey: 'NSHealthShareUsageDescription' },
    'CloudKit': { entitlement: 'com.apple.developer.icloud-services' },
    'HomeKit': { entitlement: 'com.apple.developer.homekit', plistKey: 'NSHomeKitUsageDescription' },
    'CoreLocation': { plistKey: 'NSLocationWhenInUseUsageDescription' },
    'AVFoundation': { plistKey: 'NSCameraUsageDescription' },
    'Photos': { plistKey: 'NSPhotoLibraryUsageDescription' },
    'PhotosUI': { plistKey: 'NSPhotoLibraryUsageDescription' },
    'Contacts': { plistKey: 'NSContactsUsageDescription' },
    'EventKit': { plistKey: 'NSCalendarsUsageDescription' },
    'Speech': { plistKey: 'NSSpeechRecognitionUsageDescription' },
    'LocalAuthentication': { plistKey: 'NSFaceIDUsageDescription' },
    'CoreBluetooth': { plistKey: 'NSBluetoothAlwaysUsageDescription' },
    'CoreMotion': { plistKey: 'NSMotionUsageDescription' },
    'UserNotifications': { entitlement: 'com.apple.developer.push-notifications' },
    'StoreKit': { entitlement: 'com.apple.developer.in-app-payments' },
    'MapKit': { plistKey: 'NSLocationWhenInUseUsageDescription' },
    'NearbyInteraction': { plistKey: 'NSNearbyInteractionUsageDescription' },
};
// =============================================================================
// LLM API URL PATTERNS
// =============================================================================
const LLM_URL_PATTERNS = [
    { pattern: /api\.anthropic\.com/, provider: 'Claude (Anthropic)' },
    { pattern: /api\.openai\.com/, provider: 'OpenAI' },
    { pattern: /generativelanguage\.googleapis\.com/, provider: 'Gemini (Google)' },
    { pattern: /api\.groq\.com/, provider: 'Groq' },
    { pattern: /api\.cohere\.ai/, provider: 'Cohere' },
    { pattern: /api\.mistral\.ai/, provider: 'Mistral' },
    { pattern: /api-inference\.huggingface\.co/, provider: 'HuggingFace' },
    { pattern: /api\.replicate\.com/, provider: 'Replicate' },
    { pattern: /api\.together\.xyz/, provider: 'Together AI' },
    { pattern: /api\.fireworks\.ai/, provider: 'Fireworks AI' },
    // The API path, not the bare host: `openrouter.ai/models` is a docs link.
    { pattern: /openrouter\.ai\/api\//, provider: 'OpenRouter' },
];
// Swift SDK import patterns for LLMs
// NOTE: FoundationModels is intentionally NOT here — it has its own dedicated,
// import-gated pass (scanFoundationModelsUsage below) because a bare
// `.respond(` or `@Generable` collides heavily with unrelated Swift APIs
// (URLSession delegates, custom protocols) and previously false-positived
// outside FoundationModels-importing files. See KNOWN-ISSUES.md (closed).
const LLM_IMPORT_PATTERNS = [
    { pattern: /^import\s+OpenAI\b/, provider: 'OpenAI' },
    { pattern: /^import\s+Anthropic\b/, provider: 'Claude (Anthropic)' },
    { pattern: /^import\s+GoogleGenerativeAI\b/, provider: 'Gemini (Google)' },
];
// Swift SDK call patterns
const LLM_CALL_PATTERNS = [
    { pattern: /ChatQuery\(/, provider: 'OpenAI' },
    { pattern: /\.chats\(query:/, provider: 'OpenAI' },
    { pattern: /\.completions\.create\(/, provider: 'OpenAI' },
    { pattern: /AnthropicClient\(/, provider: 'Claude (Anthropic)' },
    { pattern: /\.messages\.create\(/, provider: 'Claude (Anthropic)' },
    { pattern: /GenerativeModel\(name:/, provider: 'Gemini (Google)' },
    { pattern: /\.generateContent\(/, provider: 'Gemini (Google)' },
];
// =============================================================================
// FOUNDATIONMODELS (Apple on-device) DETECTION
// =============================================================================
//
// Gated on `import FoundationModels` appearing in the SAME file — required
// anchor per T1 Apple docs (developer.apple.com symbol JSON, 2026-08-03).
// Within a gated file, any of the following register a use case:
//   1. A `@Generable`-annotated struct/enum (bare, `(description:)`, or
//      `(name:description:)` — struct/enum only; the annotation may sit on
//      the line above the declaration).
//   2. `LanguageModelSession(` with any arguments, or the trailing-closure
//      construction form `LanguageModelSession { ... }` — there is no
//      zero-arg initializer, so a prior zero-arg-only pattern matched
//      nothing real.
//   3. `respond(to:`, `respond(generating:`, `respond(options:`,
//      `streamResponse(`, `SystemLanguageModel`, or `@Guide(` — confirming
//      signals only, never standalone (they collide with unrelated Swift
//      APIs outside a FoundationModels-importing file).
// Anchor allows leading attributes (@preconcurrency, @_exported, ...) and an
// access-level modifier (public/internal/package/fileprivate/private/open)
// before `import` — Swift permits both forms and a bare `^\s*import` anchor
// silently drops real detections in files using them (fact-checker finding
// f5, 2026-08-03). Comments and `import FoundationModelsX` still don't match:
// `//`/`*` prefixes aren't consumed by `\s*`, and `\b` blocks partial names.
const FOUNDATION_MODELS_IMPORT = /^\s*(?:@[A-Za-z_][A-Za-z0-9_]*\s+)*(?:public|internal|package|fileprivate|private|open)?\s*import\s+FoundationModels\b/;
const FOUNDATION_MODELS_SESSION_CTOR = /LanguageModelSession\s*(?:\(|\{)/;
const FOUNDATION_MODELS_CONFIRMING = [
    /\.respond\(\s*to:/,
    /\.respond\(\s*generating:/,
    /\.respond\(\s*options:/,
    /\.streamResponse\(/,
    /\bSystemLanguageModel\b/,
    /@Guide\(/,
];
const GENERABLE_ANNOTATION = /@Generable\b(?:\([^)]*\))?/;
const STRUCT_ENUM_DECL = /^\s*(?:(?:public|private|internal|open|final)\s+)*(?:struct|enum)\s+(\w+)/;
export async function scanSwiftCode(projectRoot, walkSet, knownPackages) {
    const components = [];
    const connections = [];
    const warnings = [];
    const timestamp = Date.now();
    // Load all Swift files
    const allSwiftFiles = await glob('**/*.swift', {
        cwd: projectRoot,
        ignore: [
            '.build/**',
            '**/.build/**',
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
            'DerivedData/**',
            '**/DerivedData/**',
            'SourcePackages/**',
            '**/SourcePackages/**',
            '.swiftpm/**',
            '**/.swiftpm/**',
            'Pods/**',
            '**/Pods/**',
            'Carthage/**',
            '**/Carthage/**',
            'vendor/**',
            '**/vendor/**',
            '*.playground/**',
            '**/*.playground/**',
        ],
    });
    // Walk-set restriction (incremental). Bit-identical when undefined.
    const swiftFiles = walkSet
        ? allSwiftFiles.filter(f => walkSet.has(f))
        : allSwiftFiles;
    const files = [];
    for (const relPath of swiftFiles) {
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
    /**
     * Find-or-create the `component` node for a Swift type, keyed on name+type.
     *
     * Every pass below that references a Swift type by name (conformance, state
     * observation, actor isolation) must route through this. Calling
     * `generateComponentId('component', name)` at the reference site cannot
     * work: the generator appends a random suffix (types.ts:725-729), so the id
     * computed at the edge never equals the id of the component that was pushed
     * — which is why `conforms-to`, `observes` and `other` edges all dangled.
     *
     * Creating one component per type also keeps the scan-level dedup in
     * scanner.ts (keyed `type|name|first-config-file`) from dropping a second
     * same-named component and orphaning the edges that pointed at it.
     */
    const typeComponents = new Map();
    const findOrCreateTypeComponent = (name, opts) => {
        let comp = typeComponents.get(name) ?? components.find(c => c.name === name && c.type === 'component');
        if (!comp) {
            comp = {
                component_id: generateComponentId('component', name),
                name,
                type: 'component',
                role: { purpose: opts.purpose, layer: 'backend', critical: false },
                source: { detection_method: 'auto', config_files: [], confidence: 0.85 },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: ['swift', ...opts.tags],
                metadata: { file: opts.file, line: opts.line, ...(opts.metadata ?? {}) },
                timestamp,
                last_updated: timestamp,
            };
            components.push(comp);
        }
        else {
            // Merge: a type can surface in several passes (a conforming type that is
            // also an actor). Union the tags and fill metadata gaps rather than
            // pushing a duplicate the scan-level dedup would later drop.
            for (const t of ['swift', ...opts.tags]) {
                if (!comp.tags.includes(t))
                    comp.tags.push(t);
            }
            comp.metadata = { file: opts.file, line: opts.line, ...(comp.metadata ?? {}), ...(opts.metadata ?? {}) };
        }
        typeComponents.set(name, comp);
        return comp;
    };
    // ---- String-keyed runtime deps ----
    const stringKeys = scanStringKeys(files);
    const fragileKeys = buildFragileKeys(stringKeys);
    // Create components + connections for shared keys
    const keyGroups = groupByKey(stringKeys);
    for (const [groupKey, hits] of keyGroups) {
        if (hits.length < 1)
            continue;
        const keyType = hits[0].type;
        const rawKey = hits[0].key;
        const compId = generateComponentId('other', groupKey);
        components.push({
            component_id: compId,
            name: groupKey,
            type: 'other',
            role: { purpose: `${keyType} key "${rawKey}"`, layer: 'backend', critical: hits.length > 1 },
            source: { detection_method: 'auto', config_files: [], confidence: 0.95 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['swift', 'string-key', keyType.toLowerCase(), hits.length > 1 ? 'shared' : 'single'],
            metadata: { keyType, key: rawKey, fileCount: hits.length, files: [...new Set(hits.map(h => h.file))] },
            timestamp,
            last_updated: timestamp,
        });
        for (const hit of hits) {
            connections.push({
                connection_id: generateConnectionId('stores'),
                // From the file that touches the key, not a self-loop on the key: the
                // self-loop tied the key to no code, so it read as unreachable.
                from: { component_id: `FILE:${hit.file}`, location: { file: hit.file, line: hit.line } },
                to: { component_id: compId },
                connection_type: 'stores',
                code_reference: {
                    file: hit.file,
                    symbol: hit.symbol,
                    symbol_type: 'variable',
                    line_start: hit.line,
                    code_snippet: hit.snippet.slice(0, 100),
                },
                description: `${hit.type} key "${rawKey}" in ${hit.file}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.95,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Protocol conformance ----
    const conformances = scanProtocolConformance(files);
    const protocolMap = new Map();
    for (const c of conformances) {
        for (const proto of c.protocols) {
            if (!protocolMap.has(proto))
                protocolMap.set(proto, []);
            protocolMap.get(proto).push(c);
        }
    }
    for (const [proto, conformers] of protocolMap) {
        if (conformers.length < 1)
            continue;
        const compId = generateComponentId('other', `protocol:${proto}`);
        components.push({
            component_id: compId,
            name: `protocol:${proto}`,
            type: 'other',
            role: { purpose: `Protocol ${proto} (${conformers.length} conformer${conformers.length > 1 ? 's' : ''})`, layer: 'backend', critical: conformers.length > 2 },
            source: { detection_method: 'auto', config_files: [], confidence: 0.85 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['swift', 'protocol', conformers.length > 2 ? 'widely-used' : 'local'],
            metadata: { conformers: conformers.map(c => ({ type: c.typeName, file: c.file, line: c.line })) },
            timestamp,
            last_updated: timestamp,
        });
        for (const conf of conformers) {
            // The conforming type IS the source of this edge, so push it as a real
            // component instead of pointing the edge at `FILE:${conf.file}`. The
            // FILE: form only resolved when some other scanner happened to claim
            // that file as a component, which never happens for a .swift file — so
            // every conforms-to edge dangled (1,225 of them on the Ambient Agent
            // repo). find-or-create keys on name+type so a type that also appears
            // in the actor pass below merges instead of duplicating.
            const conformerComp = findOrCreateTypeComponent(conf.typeName, {
                purpose: `Swift type: ${conf.typeName}`,
                file: conf.file,
                line: conf.line,
                tags: ['type', 'protocol-conformer'],
            });
            connections.push({
                connection_id: generateConnectionId('conforms-to'),
                from: { component_id: conformerComp.component_id, location: { file: conf.file, line: conf.line } },
                to: { component_id: compId },
                connection_type: 'conforms-to',
                code_reference: {
                    file: conf.file,
                    symbol: conf.typeName,
                    symbol_type: 'class',
                    line_start: conf.line,
                    code_snippet: `${conf.typeName}: ${conf.protocols.join(', ')}`,
                },
                description: `${conf.typeName} conforms to ${proto}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.85,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- State observation (@Published, @EnvironmentObject, etc.) ----
    const observations = scanStateObservation(files);
    // Group @Published → find consumers via @ObservedObject/@EnvironmentObject/@StateObject
    const publishers = observations.filter(o => o.wrapper === '@Published');
    const consumers = observations.filter(o => ['@ObservedObject', '@EnvironmentObject', '@StateObject'].includes(o.wrapper));
    for (const pub of publishers) {
        for (const con of consumers) {
            // Match if the consumer type matches the publisher's owner type
            if (con.ownerType !== pub.ownerType)
                continue;
            connections.push({
                connection_id: generateConnectionId('observes'),
                // Both ends resolve through find-or-create. Freshly generating the id
                // here produced a different random suffix on each of the two calls, so
                // neither endpoint matched any pushed component.
                from: {
                    component_id: findOrCreateTypeComponent(con.ownerType, {
                        purpose: `Swift observable type: ${con.ownerType}`,
                        file: con.file,
                        line: con.line,
                        tags: ['type', 'state-observation'],
                    }).component_id,
                    location: { file: con.file, line: con.line },
                },
                to: {
                    component_id: findOrCreateTypeComponent(pub.ownerType, {
                        purpose: `Swift observable type: ${pub.ownerType}`,
                        file: pub.file,
                        line: pub.line,
                        tags: ['type', 'state-observation'],
                    }).component_id,
                    location: { file: pub.file, line: pub.line },
                },
                connection_type: 'observes',
                code_reference: {
                    file: con.file,
                    symbol: con.propertyName,
                    symbol_type: 'variable',
                    line_start: con.line,
                    code_snippet: `${con.wrapper} var ${con.propertyName}: ${con.ownerType}`,
                },
                description: `${con.file} observes ${pub.ownerType}.${pub.propertyName}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.8,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Actor isolation tracking ----
    const actorHits = scanActorIsolation(files);
    const actorComponents = new Map(); // name -> component_id
    for (const hit of actorHits) {
        if (hit.type === 'actor-declaration') {
            // find-or-create, not an unconditional push: the conformance pass above
            // may already have created this type's component. Two components with
            // the same type+name and no config_files collide on scanner.ts's dedup
            // key, one gets dropped, and every edge that named the dropped id is
            // orphaned — the exact failure documented at scanner.ts's dedup block.
            const compId = findOrCreateTypeComponent(hit.name, {
                purpose: `Actor: ${hit.name}`,
                file: hit.file,
                line: hit.line,
                tags: ['actor-isolation', 'actor-declaration'],
                metadata: { actorType: 'actor' },
            }).component_id;
            actorComponents.set(hit.name, compId);
            connections.push({
                connection_id: generateConnectionId('other'),
                from: { component_id: compId, location: { file: hit.file, line: hit.line } },
                to: { component_id: compId },
                connection_type: 'other',
                code_reference: {
                    file: hit.file,
                    symbol: hit.name,
                    symbol_type: 'class',
                    line_start: hit.line,
                    code_snippet: hit.snippet.slice(0, 100),
                },
                description: `Actor declaration: ${hit.name}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.9,
                timestamp,
                last_verified: timestamp,
            });
        }
        else if (hit.type === 'main-actor') {
            // Look up by name+type (not a freshly generated id — generateComponentId()
            // appends a random suffix, so a lookup keyed on a fresh call can never
            // match a previously pushed component). Shared find-or-create now owns
            // that merge for every pass in this scanner.
            const compId = findOrCreateTypeComponent(hit.name, {
                purpose: `@MainActor: ${hit.name}`,
                file: hit.file,
                line: hit.line,
                tags: ['actor-isolation', 'main-actor'],
                metadata: { actorType: '@MainActor' },
            }).component_id;
            connections.push({
                connection_id: generateConnectionId('other'),
                from: { component_id: compId, location: { file: hit.file, line: hit.line } },
                to: { component_id: compId },
                connection_type: 'other',
                code_reference: {
                    file: hit.file,
                    symbol: hit.name,
                    symbol_type: 'class',
                    line_start: hit.line,
                    code_snippet: hit.snippet.slice(0, 100),
                },
                description: `@MainActor isolation: ${hit.name}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.9,
                timestamp,
                last_verified: timestamp,
            });
        }
        else if (hit.type === 'nonisolated') {
            // Was a fresh generateComponentId() — an id no component ever carried,
            // so the self-edge below dangled on both ends.
            const compId = findOrCreateTypeComponent(hit.name, {
                purpose: `Swift type: ${hit.name}`,
                file: hit.file,
                line: hit.line,
                tags: ['actor-isolation', 'nonisolated'],
            }).component_id;
            connections.push({
                connection_id: generateConnectionId('other'),
                from: { component_id: compId, location: { file: hit.file, line: hit.line } },
                to: { component_id: compId },
                connection_type: 'other',
                code_reference: {
                    file: hit.file,
                    symbol: hit.name,
                    symbol_type: 'function',
                    line_start: hit.line,
                    code_snippet: hit.snippet.slice(0, 100),
                },
                description: `nonisolated member: ${hit.name}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.85,
                timestamp,
                last_verified: timestamp,
            });
        }
        else if (hit.type === 'task-modifier' || hit.type === 'task-spawn') {
            // Run 4 fix2 #2a: a Task site is not a component. Attach it to the
            // ENCLOSING TYPE's component (recorded under metadata.spawns[]) and emit
            // the edge from that owner; with no enclosing type, use the file node
            // that scanner.ts (C2) synthesizes for `FILE:<path>`. Never mint a
            // `task_spawn_<path>:<line>` component — the audit adjudicated eight of
            // those as scanner naming bugs, not hallucinations.
            let compId;
            if (hit.ownerType) {
                const owner = findOrCreateTypeComponent(hit.ownerType, {
                    purpose: `Swift type: ${hit.ownerType}`,
                    file: hit.file,
                    line: hit.line,
                    tags: ['actor-isolation', hit.type],
                });
                const md = (owner.metadata ??= {});
                const spawns = (md['spawns'] ??= []);
                spawns.push({ kind: hit.type, file: hit.file, line: hit.line, symbol: hit.name });
                compId = owner.component_id;
            }
            else {
                compId = `FILE:${hit.file}`;
            }
            connections.push({
                connection_id: generateConnectionId('other'),
                from: { component_id: compId, location: { file: hit.file, line: hit.line } },
                to: { component_id: compId },
                connection_type: 'other',
                code_reference: {
                    file: hit.file,
                    symbol: hit.name,
                    symbol_type: 'function',
                    line_start: hit.line,
                    code_snippet: hit.snippet.slice(0, 100),
                },
                description: `${hit.type === 'task-modifier' ? '.task modifier' : 'Task spawning'} in ${hit.name}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.85,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- LLM API calls ----
    const llmCalls = scanLLMCalls(files);
    for (const call of llmCalls) {
        // Reuse the existing component's id when present — generateComponentId()
        // appends a random suffix, so recomputing it here (rather than reusing
        // the id actually pushed to `components`) would leave every subsequent
        // file's connection pointing at a component that was never created.
        let llmComponent = components.find(c => c.name === call.provider && c.type === 'llm');
        if (!llmComponent) {
            llmComponent = {
                component_id: generateComponentId('llm', call.provider),
                name: call.provider,
                type: 'llm',
                role: { purpose: `${call.provider} LLM API`, layer: 'external', critical: true },
                source: { detection_method: 'auto', config_files: [], confidence: 0.9 },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: ['swift', 'llm', 'external'],
                timestamp,
                last_updated: timestamp,
            };
            components.push(llmComponent);
        }
        connections.push({
            connection_id: generateConnectionId('service-call'),
            // FILE: form (matching env-scanner.ts:469, deploy-scanner.ts:440,468) so
            // scanner.ts:1578-1592 resolves it to the owning component instead of a
            // random `generateComponentId('other', ...)` id that was never pushed.
            from: { component_id: `FILE:${call.file}`, location: { file: call.file, line: call.line } },
            to: { component_id: llmComponent.component_id },
            connection_type: 'service-call',
            code_reference: {
                file: call.file,
                symbol: call.symbol,
                symbol_type: 'function',
                line_start: call.line,
                code_snippet: call.snippet.slice(0, 100),
            },
            description: `${call.provider} API call in ${call.file}`,
            detected_from: 'swift-code-scanner',
            confidence: 0.9,
            timestamp,
            last_verified: timestamp,
        });
    }
    // ---- FoundationModels (Apple on-device) — dedicated pass ----
    const foundationModels = scanFoundationModelsUsage(files);
    if (foundationModels.calls.length > 0) {
        const allSchemas = new Set();
        for (const schemaSet of foundationModels.schemas.values()) {
            for (const s of schemaSet)
                allSchemas.add(s);
        }
        const fmProvider = 'Apple Foundation Models';
        let fmComponent = components.find(c => c.name === fmProvider && c.type === 'llm');
        if (!fmComponent) {
            fmComponent = {
                component_id: generateComponentId('llm', fmProvider),
                name: fmProvider,
                type: 'llm',
                role: { purpose: `${fmProvider} on-device API`, layer: 'external', critical: true },
                source: { detection_method: 'auto', config_files: [], confidence: 0.9 },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: ['swift', 'llm', 'external', 'apple-on-device'],
                metadata: {
                    provider: 'apple-on-device',
                    kind: 'foundation-models',
                    generable_schemas: [...allSchemas],
                },
                timestamp,
                last_updated: timestamp,
            };
            components.push(fmComponent);
        }
        else {
            const existingSchemas = new Set(fmComponent.metadata?.generable_schemas || []);
            for (const s of allSchemas)
                existingSchemas.add(s);
            fmComponent.metadata = {
                ...fmComponent.metadata,
                provider: 'apple-on-device',
                kind: 'foundation-models',
                generable_schemas: [...existingSchemas],
            };
        }
        for (const call of foundationModels.calls) {
            connections.push({
                connection_id: generateConnectionId('service-call'),
                from: { component_id: `FILE:${call.file}`, location: { file: call.file, line: call.line } },
                to: { component_id: fmComponent.component_id },
                connection_type: 'service-call',
                code_reference: {
                    file: call.file,
                    symbol: call.symbol,
                    symbol_type: 'function',
                    line_start: call.line,
                    code_snippet: call.snippet.slice(0, 100),
                },
                description: `${fmProvider} API call in ${call.file}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.9,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Entitlement requirements ----
    const frameworkImports = scanFrameworkImports(files);
    const entitlementReqs = [];
    for (const imp of frameworkImports) {
        const req = FRAMEWORK_ENTITLEMENTS[imp.framework];
        if (req) {
            if (req.entitlement) {
                entitlementReqs.push({ key: req.entitlement, framework: imp.framework, file: imp.file, line: imp.line });
            }
            if (req.plistKey) {
                entitlementReqs.push({ key: req.plistKey, framework: imp.framework, file: imp.file, line: imp.line });
            }
        }
    }
    // Neither endpoint was ever a real component before this fix: no
    // `framework` component is pushed anywhere in this scanner, and no
    // `entitlement:<key>` component was ever pushed either — both were
    // dangling `generateComponentId(...)` ids (fact-checker finding). Push one
    // real entitlement component per unique key (dedup, same pattern as the
    // protocol/string-key groupings above) and use the `FILE:` form for the
    // framework side, since the requirement is tied to the importing file, not
    // to a framework component that doesn't exist.
    const entitlementGroups = new Map();
    for (const req of entitlementReqs) {
        if (!entitlementGroups.has(req.key))
            entitlementGroups.set(req.key, []);
        entitlementGroups.get(req.key).push(req);
    }
    for (const [key, reqs] of entitlementGroups) {
        const entitlementCompId = generateComponentId('other', `entitlement:${key}`);
        components.push({
            component_id: entitlementCompId,
            name: `entitlement:${key}`,
            type: 'other',
            role: { purpose: `Entitlement/plist key required: ${key}`, layer: 'infra', critical: false },
            source: { detection_method: 'auto', config_files: [], confidence: 0.85 },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['swift', 'entitlement'],
            metadata: { key, frameworks: [...new Set(reqs.map(r => r.framework))] },
            timestamp,
            last_updated: timestamp,
        });
        for (const req of reqs) {
            connections.push({
                connection_id: generateConnectionId('requires-entitlement'),
                from: { component_id: `FILE:${req.file}`, location: { file: req.file, line: req.line } },
                to: { component_id: entitlementCompId },
                connection_type: 'requires-entitlement',
                code_reference: {
                    file: req.file,
                    symbol: `import ${req.framework}`,
                    symbol_type: 'import',
                    line_start: req.line,
                    code_snippet: `import ${req.framework} → requires ${req.key}`,
                },
                description: `${req.framework} requires entitlement/plist key: ${req.key}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.85,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Prompt patterns in Swift ----
    const prompts = scanSwiftPrompts(files);
    for (const prompt of prompts) {
        const compId = generateComponentId('prompt', prompt.name);
        components.push({
            component_id: compId,
            name: prompt.name,
            type: 'prompt',
            role: { purpose: `AI prompt: ${prompt.name}`, layer: 'backend', critical: false },
            source: { detection_method: 'auto', config_files: [], confidence: prompt.confidence },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['swift', 'prompt'],
            metadata: { preview: prompt.preview },
            timestamp,
            last_updated: timestamp,
        });
        connections.push({
            connection_id: generateConnectionId('prompt-location'),
            // From the defining file (see the `stores` edges above for why).
            from: { component_id: `FILE:${prompt.file}`, location: { file: prompt.file, line: prompt.line } },
            to: { component_id: compId },
            connection_type: 'prompt-location',
            code_reference: {
                file: prompt.file,
                symbol: prompt.name,
                symbol_type: 'variable',
                line_start: prompt.line,
                code_snippet: prompt.preview.slice(0, 100),
            },
            description: `Prompt "${prompt.name}" defined in ${prompt.file}`,
            detected_from: 'swift-code-scanner',
            confidence: prompt.confidence,
            timestamp,
            last_verified: timestamp,
        });
    }
    // ---- SwiftUI view composition & navigation ----
    const swiftuiResult = scanSwiftUIViews(files);
    components.push(...swiftuiResult.components);
    connections.push(...swiftuiResult.connections);
    // ---- @main entry points ----
    //
    // `@main` marks the type the runtime launches (an App, a WidgetBundle, a
    // command-line entry). Tag it `entrypoint` so reachability starts there
    // instead of guessing from the type's name.
    for (const hit of scanMainAttributes(files)) {
        findOrCreateTypeComponent(hit.name, {
            purpose: `Swift entry point: ${hit.name}`,
            file: hit.file,
            line: hit.line,
            tags: ['type', 'entrypoint'],
        });
    }
    // ---- Package / framework imports → uses-package ----
    //
    // `import SwiftUI` in a file is that file's use of the SwiftUI node the
    // package pass created. Without this edge every framework and SwiftPM
    // dependency node was an orphan even though most files import one.
    if (knownPackages && knownPackages.length > 0) {
        const byModule = new Map();
        for (const pkg of knownPackages) {
            if (!byModule.has(pkg.module))
                byModule.set(pkg.module, pkg.component_id);
        }
        for (const imp of scanAllImports(files)) {
            const target = byModule.get(imp.module);
            if (!target)
                continue;
            connections.push({
                connection_id: generateConnectionId('uses-package'),
                from: { component_id: `FILE:${imp.file}`, location: { file: imp.file, line: imp.line } },
                to: { component_id: target },
                connection_type: 'uses-package',
                code_reference: {
                    file: imp.file,
                    symbol: imp.module,
                    symbol_type: 'import',
                    line_start: imp.line,
                    code_snippet: imp.snippet.slice(0, 100),
                },
                description: `${imp.file} imports ${imp.module}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.9,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Cross-file type references → references ----
    //
    // Files in one Swift module see each other's types with no import
    // statement, so the only file-to-file coupling Swift source carries is a
    // type used in one file and declared in another. Resolve each capitalized
    // identifier against the project's own type declarations and emit
    // `references` from the using file to the declaring type (or its file, when
    // no component exists for that type). Typed `references`, not `imports`:
    // two files of one module naming each other's types is ordinary Swift, not
    // an import cycle.
    //
    // A name declared in more than one file resolves only when one
    // declaration is strictly nearer the using file by shared directory
    // prefix: Swift resolves names within the module being compiled, and a
    // copy in another tree (a stub under docs/, a second app target) is not
    // what this file sees. A file that declares the name itself uses its own
    // declaration. Otherwise (two `State`s in sibling folders) it is skipped:
    // guessing would invent coupling.
    const declarations = scanTypeDeclarations(files);
    // A copy of a type compiled only under a custom flag (`#if SOME_DRILL`,
    // a test harness stubbing the production type) is not what ordinary code
    // sees. Code outside such a region resolves against the unflagged
    // declarations when any exist; code inside one keeps every candidate.
    const gatedLines = new Map();
    for (const f of files)
        gatedLines.set(f.relativePath, customFlagGatedLines(stripSwiftNonCode(f.content)));
    const gatedDecls = scanFlagGatedDeclarations(files, gatedLines);
    const visibleDeclarations = (file, line, name) => {
        const all = declarations.get(name);
        const gated = gatedDecls.get(name);
        if (!all || !gated || gatedLines.get(file)?.[line - 1])
            return all;
        const ungated = new Set([...all].filter(d => !gated.has(d)));
        return ungated.size > 0 ? ungated : all;
    };
    // name → node, and the file that node was recorded in: with a name
    // declared in two places, the node is the target only when it is the
    // declaration the use resolved to.
    const componentByName = new Map();
    for (const c of components) {
        if (c.type !== 'component' || componentByName.has(c.name))
            continue;
        const f = c.metadata?.['file'];
        componentByName.set(c.name, { id: c.component_id, file: typeof f === 'string' ? f : undefined });
    }
    for (const file of files) {
        const seenTargets = new Set();
        for (const ref of scanTypeIdentifiers(file)) {
            const declFiles = visibleDeclarations(file.relativePath, ref.line, ref.name);
            if (!declFiles)
                continue;
            const declFile = nearestDeclaration(file.relativePath, declFiles);
            if (!declFile || declFile === file.relativePath)
                continue;
            const node = componentByName.get(ref.name);
            const target = node && (declarations.get(ref.name).size === 1 || node.file === declFile)
                ? node.id
                : `FILE:${declFile}`;
            if (seenTargets.has(target))
                continue;
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
                description: `${file.relativePath} references ${ref.name} (declared in ${declFile})`,
                detected_from: 'swift-code-scanner',
                confidence: 0.8,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Extensions → the extended type's file reaches the extending file ----
    //
    // A file holding only `extension WorkStore { ... }` contributes methods to
    // WorkStore; callers name WorkStore, never this file, so no reference
    // reaches it. Record that WorkStore is extended here (typed `other`, from
    // the type to the extending file) so a live type keeps its extension files
    // live. Extensions of types the project does not declare (Foundation's
    // JSONDecoder) have no declaration to anchor to and are skipped.
    for (const file of files) {
        const code = stripSwiftNonCode(file.content);
        const re = /\bextension\s+([A-Z]\w*)/g;
        const seen = new Set();
        let m;
        while ((m = re.exec(code)) !== null) {
            const name = m[1];
            if (seen.has(name))
                continue;
            seen.add(name);
            const line = code.slice(0, m.index).split('\n').length;
            const declFiles = visibleDeclarations(file.relativePath, line, name);
            if (!declFiles)
                continue;
            const declFile = nearestDeclaration(file.relativePath, declFiles);
            if (!declFile || declFile === file.relativePath)
                continue;
            const node = componentByName.get(name);
            const source = node && (declarations.get(name).size === 1 || node.file === declFile) ? node.id : `FILE:${declFile}`;
            connections.push({
                connection_id: generateConnectionId('other'),
                from: { component_id: source, location: { file: declFile, line: 1 } },
                to: { component_id: `FILE:${file.relativePath}`, location: { file: file.relativePath, line } },
                connection_type: 'other',
                code_reference: {
                    file: file.relativePath,
                    symbol: name,
                    symbol_type: 'class',
                    line_start: line,
                    code_snippet: (file.lines[line - 1] ?? '').trim().slice(0, 100),
                },
                description: `${name} is extended in ${file.relativePath}`,
                detected_from: 'swift-code-scanner',
                confidence: 0.85,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // ---- Build project metadata ----
    const projectMeta = buildProjectMetadata(files, frameworkImports, projectRoot, fragileKeys, entitlementReqs);
    return { components, connections, warnings, projectMeta };
}
// =============================================================================
// STRING KEY DETECTION
// =============================================================================
function scanStringKeys(files) {
    const hits = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
                continue;
            // @AppStorage("key") — normalizes to UserDefaults since @AppStorage is a UserDefaults wrapper
            const appStorageMatch = line.match(/@AppStorage\(["']([^"']+)["']\)/);
            if (appStorageMatch) {
                hits.push({
                    key: appStorageMatch[1],
                    type: 'UserDefaults',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || appStorageMatch[1],
                    snippet: trimmed,
                });
            }
            // UserDefaults.standard.set(..., forKey: "key") / .object(forKey: "key") / etc.
            const udWriteMatch = line.match(/UserDefaults\.(?:standard|[a-zA-Z]+)\.(?:set|setValue|removeObject)\([^)]*forKey:\s*["']([^"']+)["']\)/);
            if (udWriteMatch) {
                hits.push({
                    key: udWriteMatch[1],
                    type: 'UserDefaults',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || udWriteMatch[1],
                    snippet: trimmed,
                });
            }
            const udReadMatch = line.match(/UserDefaults\.(?:standard|[a-zA-Z]+)\.(?:object|string|integer|bool|double|float|array|dictionary|data|url)\(forKey:\s*["']([^"']+)["']\)/);
            if (udReadMatch) {
                hits.push({
                    key: udReadMatch[1],
                    type: 'UserDefaults',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || udReadMatch[1],
                    snippet: trimmed,
                });
            }
            // NotificationCenter — .post(name: .someNotification) or Notification.Name("string")
            const notifPostMatch = line.match(/\.post\(name:\s*(?:\.(\w+)|Notification\.Name\(["']([^"']+)["']\))/);
            if (notifPostMatch) {
                const key = notifPostMatch[1] || notifPostMatch[2];
                hits.push({
                    key,
                    type: 'NotificationCenter',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || key,
                    snippet: trimmed,
                });
            }
            const notifObserveMatch = line.match(/\.addObserver\([^)]*name:\s*(?:\.(\w+)|Notification\.Name\(["']([^"']+)["']\))/);
            if (notifObserveMatch) {
                const key = notifObserveMatch[1] || notifObserveMatch[2];
                hits.push({
                    key,
                    type: 'NotificationCenter',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || key,
                    snippet: trimmed,
                });
            }
            // Image("name") or Image(systemName: "name") — asset names
            const imageMatch = line.match(/Image\(\s*["']([^"']+)["']\s*\)/);
            if (imageMatch) {
                hits.push({
                    key: imageMatch[1],
                    type: 'AssetName',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || imageMatch[1],
                    snippet: trimmed,
                });
            }
            // UIImage(named: "name")
            const uiImageMatch = line.match(/UIImage\(named:\s*["']([^"']+)["']\)/);
            if (uiImageMatch) {
                hits.push({
                    key: uiImageMatch[1],
                    type: 'AssetName',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || uiImageMatch[1],
                    snippet: trimmed,
                });
            }
            // Color("name")
            const colorMatch = line.match(/Color\(\s*["']([^"']+)["']\s*\)/);
            if (colorMatch) {
                hits.push({
                    key: colorMatch[1],
                    type: 'AssetName',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || colorMatch[1],
                    snippet: trimmed,
                });
            }
            // NSSound(named: .init("name"))
            const nsSoundMatch = line.match(/NSSound\(named:\s*\.init\(["']([^"']+)["']\)\)/);
            if (nsSoundMatch) {
                hits.push({
                    key: nsSoundMatch[1],
                    type: 'AssetName',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || nsSoundMatch[1],
                    snippet: trimmed,
                });
            }
            // Keychain — kSecAttrService or KeychainAccess
            const keychainMatch = line.match(/(?:kSecAttrService|kSecAttrAccount|Keychain\(service:)\s*(?::|as\s+.+?,\s*)?["']([^"']+)["']/);
            if (keychainMatch) {
                hits.push({
                    key: keychainMatch[1],
                    type: 'Keychain',
                    file: file.relativePath,
                    line: i + 1,
                    symbol: extractNearestSymbol(file.lines, i) || keychainMatch[1],
                    snippet: trimmed,
                });
            }
        }
    }
    return hits;
}
// =============================================================================
// PROTOCOL CONFORMANCE
// =============================================================================
function scanProtocolConformance(files) {
    const conformances = [];
    // Well-known protocols worth tracking
    const interestingProtocols = new Set([
        'ObservableObject', 'Observable', 'Codable', 'Decodable', 'Encodable',
        'Identifiable', 'Hashable', 'Equatable', 'Comparable',
        'View', 'App', 'Scene', 'Widget', 'TimelineProvider',
        'Sendable', 'Actor',
        'URLSessionDelegate', 'URLSessionDataDelegate',
    ]);
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            // Match: struct/class/enum/actor TypeName: Protocol1, Protocol2 {
            const match = line.match(/^\s*(?:(?:public|private|internal|open|final|@\w+)\s+)*(?:struct|class|enum|actor)\s+(\w+)\s*(?:<[^>]*>)?\s*:\s*([^{]+)/);
            if (match) {
                const typeName = match[1];
                const rawProtocols = match[2].split(',').map(p => p.trim()).filter(Boolean);
                const protocols = rawProtocols.filter(p => {
                    // Filter out generic superclasses (rough heuristic: known protocols or capitalized single words)
                    return interestingProtocols.has(p) || /^[A-Z]\w+(?:Protocol|Delegate|DataSource|able)$/.test(p);
                });
                if (protocols.length > 0) {
                    conformances.push({ typeName, protocols, file: file.relativePath, line: i + 1 });
                }
            }
        }
    }
    return conformances;
}
// =============================================================================
// STATE OBSERVATION
// =============================================================================
function scanStateObservation(files) {
    const observations = [];
    const wrappers = ['@Published', '@ObservedObject', '@EnvironmentObject', '@StateObject', '@State', '@Binding'];
    for (const file of files) {
        let currentType = '';
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            // Track current type context
            const typeMatch = line.match(/^\s*(?:(?:public|private|internal|open|final|@\w+)\s+)*(?:struct|class|enum|actor)\s+(\w+)/);
            if (typeMatch) {
                currentType = typeMatch[1];
            }
            for (const wrapper of wrappers) {
                if (!line.includes(wrapper))
                    continue;
                // Match: @Published var name: Type
                const propMatch = line.match(new RegExp(`${wrapper.replace('$', '\\$')}\\s+(?:private\\s+|private\\(set\\)\\s+)?var\\s+(\\w+)\\s*(?::\\s*(\\w+))?`));
                if (propMatch) {
                    const propName = propMatch[1];
                    const propType = propMatch[2] || '';
                    // For @Published, the ownerType is the containing type's name (what gets observed)
                    // For @ObservedObject/@EnvironmentObject, the propType IS the observed type
                    const ownerType = wrapper === '@Published' ? currentType : propType;
                    observations.push({
                        propertyName: propName,
                        wrapper,
                        ownerType,
                        file: file.relativePath,
                        line: i + 1,
                    });
                }
            }
        }
    }
    return observations;
}
// =============================================================================
// LLM CALL DETECTION
// =============================================================================
function scanLLMCalls(files) {
    const calls = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*'))
                continue;
            // Check URL patterns in string literals
            for (const { pattern, provider } of LLM_URL_PATTERNS) {
                if (pattern.test(line)) {
                    calls.push({
                        provider,
                        url: line.match(/"([^"]*)"/)?.[1],
                        file: file.relativePath,
                        line: i + 1,
                        symbol: extractNearestSymbol(file.lines, i) || 'urlRequest',
                        snippet: trimmed,
                    });
                }
            }
            // Check SDK import patterns
            for (const { pattern, provider } of LLM_IMPORT_PATTERNS) {
                if (pattern.test(trimmed)) {
                    calls.push({
                        provider,
                        file: file.relativePath,
                        line: i + 1,
                        symbol: `import ${provider}`,
                        snippet: trimmed,
                    });
                }
            }
            // Check SDK call patterns
            for (const { pattern, provider } of LLM_CALL_PATTERNS) {
                if (pattern.test(line)) {
                    calls.push({
                        provider,
                        file: file.relativePath,
                        line: i + 1,
                        symbol: extractNearestSymbol(file.lines, i) || provider,
                        snippet: trimmed,
                    });
                }
            }
        }
    }
    // Deduplicate by file+provider (keep first occurrence)
    const seen = new Set();
    return calls.filter(c => {
        const key = `${c.file}:${c.provider}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
/**
 * Dedicated FoundationModels (Apple on-device LLM) detection pass.
 * Gated on `import FoundationModels` in the same file — see the constants
 * block above for the full rationale and pattern list.
 */
function scanFoundationModelsUsage(files) {
    const calls = [];
    const schemas = new Map();
    for (const file of files) {
        // False-positive guard: nothing below runs unless this file imports
        // FoundationModels.
        if (!file.lines.some(l => FOUNDATION_MODELS_IMPORT.test(l)))
            continue;
        let fileHasSignal = false;
        let hitLine = -1;
        let hitSymbol = '';
        let hitSnippet = '';
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
                continue;
            // @Generable-annotated struct/enum. The annotation may be inline with
            // the declaration or on the preceding line(s).
            if (GENERABLE_ANNOTATION.test(line)) {
                let name;
                const inlineDecl = line.replace(GENERABLE_ANNOTATION, '').match(STRUCT_ENUM_DECL);
                if (inlineDecl) {
                    name = inlineDecl[1];
                }
                else {
                    for (let j = i + 1; j < Math.min(i + 4, file.lines.length); j++) {
                        if (file.lines[j].trim() === '')
                            continue;
                        const declMatch = file.lines[j].match(STRUCT_ENUM_DECL);
                        if (declMatch)
                            name = declMatch[1];
                        break; // only the nearest non-blank line counts
                    }
                }
                if (name) {
                    if (!schemas.has(file.relativePath))
                        schemas.set(file.relativePath, new Set());
                    schemas.get(file.relativePath).add(name);
                    if (!fileHasSignal) {
                        fileHasSignal = true;
                        hitLine = i + 1;
                        hitSymbol = name;
                        hitSnippet = trimmed;
                    }
                }
            }
            // Session construction (any-argument or trailing-closure form) or a
            // confirming signal.
            const isConstruction = FOUNDATION_MODELS_SESSION_CTOR.test(line);
            const isConfirming = FOUNDATION_MODELS_CONFIRMING.some(p => p.test(line));
            if ((isConstruction || isConfirming) && !fileHasSignal) {
                fileHasSignal = true;
                hitLine = i + 1;
                hitSymbol = extractNearestSymbol(file.lines, i) || 'LanguageModelSession';
                hitSnippet = trimmed;
            }
        }
        if (fileHasSignal) {
            calls.push({ file: file.relativePath, line: hitLine, symbol: hitSymbol, snippet: hitSnippet });
        }
    }
    return { calls, schemas };
}
// =============================================================================
// FRAMEWORK IMPORT SCANNING (for entitlement detection)
// =============================================================================
/** `import X`, `@testable import X`, `import struct X.Y` — every one, per file. */
function scanAllImports(files) {
    const results = [];
    for (const file of files) {
        const seen = new Set();
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            const match = line.match(/^\s*(?:@\w+(?:\([^)]*\))?\s+)*import\s+(?:(?:struct|class|enum|protocol|func|var|let|typealias)\s+)?(\w+)/);
            if (!match || seen.has(match[1]))
                continue;
            seen.add(match[1]);
            results.push({ module: match[1], file: file.relativePath, line: i + 1, snippet: line.trim() });
        }
    }
    return results;
}
/** Types declared with `@main` (attribute on its own line or inline). */
function scanMainAttributes(files) {
    const hits = [];
    for (const file of files) {
        const code = stripSwiftNonCode(file.content);
        const re = /@main\b[\s\S]{0,200}?\b(?:struct|class|enum|actor)\s+([A-Za-z_]\w*)/g;
        let m;
        while ((m = re.exec(code)) !== null) {
            const line = code.slice(0, m.index).split('\n').length;
            hits.push({ name: m[1], file: file.relativePath, line });
        }
    }
    return hits;
}
/**
 * Blank out comments and string-literal text, keeping newlines (line numbers)
 * and the code inside `\( … )` interpolations, where type references are real.
 */
export function stripSwiftNonCode(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    const blank = (text) => text.replace(/[^\n]/g, ' ');
    // Copy a string literal starting at `start` (its `#`/quote run), keeping
    // interpolations. Returns the index just past the literal.
    const copyString = (start) => {
        const hashes = /^#*/.exec(src.slice(start, start + 16))[0];
        let j = start + hashes.length;
        const multi = src.startsWith('"""', j);
        const quote = multi ? '"""' : '"';
        const close = quote + hashes;
        out += blank(src.slice(start, j + quote.length));
        j += quote.length;
        const interp = `\\${hashes}(`;
        while (j < n) {
            if (src.startsWith(close, j)) {
                out += blank(close);
                return j + close.length;
            }
            if (!multi && src[j] === '\n')
                return j; // unterminated single-line literal
            if (src.startsWith(interp, j)) {
                out += blank(interp);
                j += interp.length;
                let depth = 1;
                const exprStart = j;
                while (j < n && depth > 0) {
                    if (src[j] === '(')
                        depth++;
                    else if (src[j] === ')')
                        depth--;
                    if (depth > 0)
                        j++;
                }
                out += stripSwiftNonCode(src.slice(exprStart, j));
                if (j < n) {
                    out += ' ';
                    j++;
                }
                continue;
            }
            if (!hashes && src[j] === '\\') {
                out += blank(src.slice(j, j + 2));
                j += 2;
                continue;
            }
            out += src[j] === '\n' ? '\n' : ' ';
            j++;
        }
        return j;
    };
    while (i < n) {
        const c = src[i];
        const next = src[i + 1];
        if (c === '/' && next === '/') {
            let j = src.indexOf('\n', i);
            if (j === -1)
                j = n;
            out += blank(src.slice(i, j));
            i = j;
        }
        else if (c === '/' && next === '*') {
            let depth = 1;
            let j = i + 2;
            while (j < n && depth > 0) {
                if (src[j] === '/' && src[j + 1] === '*') {
                    depth++;
                    j += 2;
                }
                else if (src[j] === '*' && src[j + 1] === '/') {
                    depth--;
                    j += 2;
                }
                else
                    j++;
            }
            out += blank(src.slice(i, j));
            i = j;
        }
        else if (c === '"' || (c === '#' && /^#+"/.test(src.slice(i, i + 8)))) {
            i = copyString(i);
        }
        else {
            out += c;
            i++;
        }
    }
    return out;
}
/** Number of leading directory segments two repo-relative paths share. */
function sharedDirDepth(a, b) {
    const da = a.split('/').slice(0, -1);
    const db = b.split('/').slice(0, -1);
    let n = 0;
    while (n < da.length && n < db.length && da[n] === db[n])
        n++;
    return n;
}
/**
 * The declaration a use in `file` means: the only one, the file's own, or the
 * one strictly nearest by shared directory prefix. Undefined on a tie.
 */
function nearestDeclaration(file, declFiles) {
    if (declFiles.size === 1)
        return [...declFiles][0];
    if (declFiles.has(file))
        return file;
    let best;
    let bestDepth = -1;
    let tied = false;
    for (const d of declFiles) {
        const depth = sharedDirDepth(file, d);
        if (depth > bestDepth) {
            best = d;
            bestDepth = depth;
            tied = false;
        }
        else if (depth === bestDepth)
            tied = true;
    }
    return tied ? undefined : best;
}
/** name → files that declare a type (struct/class/enum/actor/protocol/typealias) of that name. */
function scanTypeDeclarations(files) {
    const decls = new Map();
    for (const file of files) {
        const code = stripSwiftNonCode(file.content);
        // Capitalized names only: `class func` / `class var` are members, not types.
        const re = /\b(?:struct|class|enum|actor|protocol|typealias)\s+([A-Z]\w*)/g;
        let m;
        while ((m = re.exec(code)) !== null) {
            if (!decls.has(m[1]))
                decls.set(m[1], new Set());
            decls.get(m[1]).add(file.relativePath);
        }
    }
    return decls;
}
/**
 * Per line of `code` (already stripped of comments and strings): true when
 * the line sits inside an `#if` branch that is compiled only when a custom
 * flag is set (`#if CALENDAR_LIFECYCLE_DRILL`). `DEBUG`, `SWIFT_PACKAGE`,
 * platform and compiler conditions, negations and compound conditions are
 * treated as ordinarily compiled. The `#else` of a custom flag is the
 * ordinary branch.
 */
function customFlagGatedLines(code) {
    const lines = code.split('\n');
    const out = new Array(lines.length).fill(false);
    const stack = [];
    const isCustomFlag = (cond) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(cond) && cond !== 'DEBUG' && cond !== 'SWIFT_PACKAGE';
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        let m;
        if ((m = /^#if\s+(.+)$/.exec(t))) {
            stack.push(isCustomFlag(m[1].trim()));
        }
        else if ((m = /^#elseif\s+(.+)$/.exec(t))) {
            if (stack.length)
                stack[stack.length - 1] = isCustomFlag(m[1].trim());
        }
        else if (/^#else\b/.test(t)) {
            if (stack.length)
                stack[stack.length - 1] = false;
        }
        else if (/^#endif\b/.test(t)) {
            stack.pop();
        }
        out[i] = stack.some(Boolean);
    }
    return out;
}
/** name → files whose every declaration of that type sits in a custom-flag `#if` branch. */
function scanFlagGatedDeclarations(files, gatedLines) {
    const gated = new Map();
    for (const file of files) {
        const lineGated = gatedLines.get(file.relativePath) ?? [];
        if (!lineGated.some(Boolean))
            continue;
        const code = stripSwiftNonCode(file.content);
        const re = /\b(?:struct|class|enum|actor|protocol|typealias)\s+([A-Z]\w*)/g;
        const state = new Map(); // name → all declarations gated so far
        let m;
        while ((m = re.exec(code)) !== null) {
            const line = code.slice(0, m.index).split('\n').length;
            const isGated = lineGated[line - 1] === true;
            state.set(m[1], (state.get(m[1]) ?? true) && isGated);
        }
        for (const [name, allGated] of state) {
            if (!allGated)
                continue;
            if (!gated.has(name))
                gated.set(name, new Set());
            gated.get(name).add(file.relativePath);
        }
    }
    return gated;
}
/** Distinct capitalized identifiers in code (not comments/strings), with their first line. */
function scanTypeIdentifiers(file) {
    const code = stripSwiftNonCode(file.content);
    const lines = code.split('\n');
    const first = new Map();
    for (let i = 0; i < lines.length; i++) {
        const re = /(?<![\w.$@#])([A-Z][A-Za-z0-9_]*)\b/g;
        let m;
        while ((m = re.exec(lines[i])) !== null) {
            if (!first.has(m[1]))
                first.set(m[1], i + 1);
        }
    }
    return [...first.entries()].map(([name, line]) => ({ name, line }));
}
function scanFrameworkImports(files) {
    const results = [];
    const entitlementFrameworks = new Set(Object.keys(FRAMEWORK_ENTITLEMENTS));
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const match = file.lines[i].match(/^\s*import\s+(\w+)/);
            if (match && entitlementFrameworks.has(match[1])) {
                results.push({ framework: match[1], file: file.relativePath, line: i + 1 });
            }
        }
    }
    // Deduplicate by framework (keep first)
    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.framework))
            return false;
        seen.add(r.framework);
        return true;
    });
}
// =============================================================================
// ACTOR ISOLATION DETECTION
// =============================================================================
function scanActorIsolation(files) {
    const hits = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
                continue;
            // Match: @MainActor class/struct/func/var
            const mainActorMatch = line.match(/@MainActor\s+(?:(?:public|private|internal|open|final|static)\s+)*(?:class|struct|func|var)\s+(\w+)/);
            if (mainActorMatch) {
                hits.push({
                    type: 'main-actor',
                    name: mainActorMatch[1],
                    file: file.relativePath,
                    line: i + 1,
                    snippet: trimmed,
                });
            }
            // Match: nonisolated func/var
            const nonisolatedMatch = line.match(/nonisolated\s+(?:(?:public|private|internal|open|static)\s+)*(?:func|var)\s+(\w+)/);
            if (nonisolatedMatch) {
                hits.push({
                    type: 'nonisolated',
                    name: nonisolatedMatch[1],
                    file: file.relativePath,
                    line: i + 1,
                    snippet: trimmed,
                });
            }
            // Match: actor MyActor { (standalone actor declarations)
            const actorDeclMatch = line.match(/^\s*(?:(?:public|private|internal|open|final|@\w+)\s+)*actor\s+(\w+)\s*(?:<[^>]*>)?\s*(?::\s*[^{]+)?\s*\{/);
            if (actorDeclMatch) {
                hits.push({
                    type: 'actor-declaration',
                    name: actorDeclMatch[1],
                    file: file.relativePath,
                    line: i + 1,
                    snippet: trimmed,
                });
            }
            // Match: .task { } (SwiftUI view modifier)
            // Run 4 fix2 #2a: `name` is the nearest declared symbol (the edge's
            // code_reference.symbol, which must appear in the file) or the literal
            // `task` / `Task` token — never a `<path>:<line>` pseudo-name.
            const taskModifierMatch = line.match(/\.task\s*\{/);
            if (taskModifierMatch) {
                const name = extractNearestSymbol(file.lines, i) || 'task';
                hits.push({
                    type: 'task-modifier',
                    name,
                    file: file.relativePath,
                    line: i + 1,
                    snippet: trimmed,
                    ownerType: extractEnclosingType(file.lines, i),
                });
            }
            // Match: Task { } or Task.detached { }
            const taskSpawnMatch = line.match(/Task\s*(?:\.detached\s*)?\{/);
            if (taskSpawnMatch) {
                const name = extractNearestSymbol(file.lines, i) || 'Task';
                hits.push({
                    type: 'task-spawn',
                    name,
                    file: file.relativePath,
                    line: i + 1,
                    snippet: trimmed,
                    ownerType: extractEnclosingType(file.lines, i),
                });
            }
        }
    }
    return hits;
}
// =============================================================================
// PROMPT DETECTION IN SWIFT
// =============================================================================
function scanSwiftPrompts(files) {
    const prompts = [];
    for (const file of files) {
        for (let i = 0; i < file.lines.length; i++) {
            const line = file.lines[i];
            // Match: static let systemPrompt = """ ... """
            // Match: let prompt = "You are a..."
            // Match: var SYSTEM_PROMPT = """
            const promptVarMatch = line.match(/(?:static\s+)?(?:let|var)\s+(\w*(?:[Pp]rompt|[Ss]ystem|[Ii]nstruction)\w*)\s*(?::\s*String)?\s*=\s*(".*"|""")/);
            if (promptVarMatch) {
                const name = promptVarMatch[1];
                let preview = promptVarMatch[2];
                // For multi-line strings, grab more lines
                if (preview === '"""') {
                    const nextLines = [];
                    for (let j = i + 1; j < Math.min(i + 10, file.lines.length); j++) {
                        if (file.lines[j].includes('"""'))
                            break;
                        nextLines.push(file.lines[j].trim());
                    }
                    preview = nextLines.join(' ').slice(0, 200);
                }
                prompts.push({
                    name,
                    file: file.relativePath,
                    line: i + 1,
                    preview: preview.replace(/^"|"$/g, '').slice(0, 200),
                    confidence: 0.85,
                });
            }
            // Match: "role": "system" or role: .system in messages arrays
            if (/role.*system/i.test(line) && /content|message/i.test(file.lines[Math.min(i + 1, file.lines.length - 1)] || '')) {
                const name = extractNearestSymbol(file.lines, i) || `prompt_${file.relativePath}:${i + 1}`;
                prompts.push({
                    name,
                    file: file.relativePath,
                    line: i + 1,
                    preview: line.trim().slice(0, 200),
                    confidence: 0.7,
                });
            }
        }
    }
    return prompts;
}
// =============================================================================
// PROJECT METADATA BUILDER
// =============================================================================
function buildProjectMetadata(files, frameworkImports, projectRoot, fragileKeys, entitlementReqs) {
    const meta = { type: 'swift-app' };
    // Detect platforms from framework usage
    const platforms = new Set();
    const allImports = new Set();
    for (const file of files) {
        for (const line of file.lines) {
            const m = line.match(/^\s*import\s+(\w+)/);
            if (m)
                allImports.add(m[1]);
        }
    }
    if (allImports.has('UIKit') || allImports.has('SwiftUI'))
        platforms.add('iOS');
    if (allImports.has('AppKit'))
        platforms.add('macOS');
    if (allImports.has('WatchKit'))
        platforms.add('watchOS');
    if (allImports.has('WidgetKit'))
        platforms.add('iOS'); // Widgets are iOS typically
    // SwiftUI can be any platform — check for platform-specific APIs
    if (allImports.has('SwiftUI') && !allImports.has('UIKit') && !allImports.has('AppKit')) {
        platforms.add('iOS'); // Default assumption for SwiftUI-only
        platforms.add('macOS');
    }
    meta.platforms = [...platforms];
    // Detect architecture pattern
    if (allImports.has('ComposableArchitecture')) {
        meta.architecture_pattern = 'TCA (Composable Architecture)';
    }
    else {
        // Check for MVVM indicators: ObservableObject/Observable classes separate from Views
        const hasObservableObjects = files.some(f => f.content.includes('ObservableObject') || f.content.includes('@Observable'));
        const hasViews = files.some(f => f.content.includes(': View'));
        if (hasObservableObjects && hasViews) {
            meta.architecture_pattern = 'MVVM';
        }
        else if (allImports.has('UIKit') && files.some(f => f.content.includes(': UIViewController'))) {
            meta.architecture_pattern = 'MVC';
        }
    }
    // Detect deployment target from Package.swift
    try {
        const pkgSwiftPath = path.join(projectRoot, 'Package.swift');
        if (fs.existsSync(pkgSwiftPath)) {
            const pkgContent = fs.readFileSync(pkgSwiftPath, 'utf-8');
            const deployments = {};
            const platformMatches = pkgContent.matchAll(/\.(iOS|macOS|watchOS|tvOS|visionOS)\("([^"]+)"\)/g);
            for (const m of platformMatches) {
                deployments[m[1]] = m[2];
            }
            const platformMatchesV2 = pkgContent.matchAll(/\.(iOS|macOS|watchOS|tvOS|visionOS)\(\.v(\d+)/g);
            for (const m of platformMatchesV2) {
                deployments[m[1]] = `${m[2]}.0`;
            }
            if (Object.keys(deployments).length > 0) {
                meta.min_deployment = deployments;
            }
        }
    }
    catch {
        // Skip if unreadable
    }
    // Parse targets from Package.swift
    try {
        const pkgSwiftPath = path.join(projectRoot, 'Package.swift');
        if (fs.existsSync(pkgSwiftPath)) {
            const pkgContent = fs.readFileSync(pkgSwiftPath, 'utf-8');
            const targets = parseSwiftPackageTargets(pkgContent);
            if (targets.length > 0) {
                meta.targets = targets;
            }
        }
    }
    catch {
        // Skip
    }
    // Entitlements
    if (entitlementReqs.length > 0) {
        meta.entitlements = entitlementReqs.map(r => ({ key: r.key, file: r.framework }));
    }
    // Fragile keys
    meta.fragile_keys = fragileKeys;
    return meta;
}
// =============================================================================
// HELPERS
// =============================================================================
/**
 * Nearest enclosing type declaration above `lineIndex`: the closest preceding
 * `class|struct|enum|actor|extension Name` whose brace block is still open at
 * the hit (tracked by counting braces between the declaration and the hit).
 * Returns undefined for file-scope Task sites.
 */
function extractEnclosingType(lines, lineIndex) {
    const decl = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|fileprivate|open|final|indirect)\s+)*(?:class|struct|enum|actor|extension)\s+([A-Za-z_][\w]*)/;
    for (let j = lineIndex - 1; j >= 0; j--) {
        const m = lines[j].match(decl);
        if (!m)
            continue;
        // Is this declaration's block still open at the hit line?
        let depth = 0;
        for (let k = j; k < lineIndex; k++) {
            for (const ch of lines[k]) {
                if (ch === '{')
                    depth++;
                else if (ch === '}')
                    depth--;
            }
        }
        if (depth > 0)
            return m[1];
    }
    return undefined;
}
function extractNearestSymbol(lines, lineIndex) {
    // Look backwards for func/var/let/class/struct declaration
    for (let j = lineIndex; j >= Math.max(0, lineIndex - 5); j--) {
        const funcMatch = lines[j].match(/(?:func|var|let|class|struct|enum)\s+(\w+)/);
        if (funcMatch)
            return funcMatch[1];
    }
    return undefined;
}
function groupByKey(hits) {
    const groups = new Map();
    for (const hit of hits) {
        const key = `${hit.type}:${hit.key}`;
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(hit);
    }
    return groups;
}
function buildFragileKeys(hits) {
    const groups = groupByKey(hits);
    const fragile = [];
    for (const [key, keyHits] of groups) {
        fragile.push({
            key,
            type: keyHits[0].type,
            files: [...new Set(keyHits.map(h => h.file))],
        });
    }
    return fragile.length > 0 ? fragile : undefined;
}
/**
 * Parse the local target graph out of a Package.swift manifest.
 *
 * The manifest is Swift source, not data, so this is a bounded textual parse:
 * find each target declaration, take its argument list by balancing
 * parentheses (skipping string literals and comments), then read the
 * `dependencies:` array inside it. Handles the four dependency spellings SPM
 * accepts: a bare "Name" string, .target(name:), .byName(name:), and
 * .product(name:package:).
 */
export function parseSwiftPackageTargets(pkgContent) {
    const targets = [];
    const declRe = /\.(executableTarget|testTarget|target|macro|plugin|systemLibrary|binaryTarget)\(/g;
    let decl;
    while ((decl = declRe.exec(pkgContent)) !== null) {
        const kind = decl[1];
        const openParen = decl.index + decl[0].length - 1;
        const body = sliceBalanced(pkgContent, openParen, '(', ')');
        if (body === null)
            continue;
        const nameMatch = /name:\s*"([^"]+)"/.exec(stripComments(body));
        if (!nameMatch)
            continue;
        const type = kind === 'testTarget' ? 'test' : kind === 'executableTarget' ? 'executable' : 'library';
        targets.push({
            name: nameMatch[1],
            type,
            dependencies: extractTargetDependencies(body),
        });
    }
    return targets;
}
/**
 * Return the text between `open` at `openIndex` and its matching `close`,
 * exclusive. Skips over string literals and // and /* *\/ comments so that a
 * bracket inside a string or comment cannot unbalance the scan. Returns null
 * when the manifest is truncated or unbalanced.
 */
function sliceBalanced(src, openIndex, open, close) {
    let depth = 0;
    let i = openIndex;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '"') {
            i++;
            while (i < src.length && src[i] !== '"') {
                if (src[i] === '\\')
                    i++;
                i++;
            }
            i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n')
                i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/'))
                i++;
            i += 2;
            continue;
        }
        if (ch === open)
            depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0)
                return src.slice(openIndex + 1, i);
        }
        i++;
    }
    return null;
}
/**
 * Remove // and /* *\/ comments, preserving string literals so that a `//`
 * inside a string is not mistaken for a comment.
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '"') {
            out += ch;
            i++;
            while (i < src.length && src[i] !== '"') {
                if (src[i] === '\\') {
                    out += src[i];
                    i++;
                }
                out += src[i];
                i++;
            }
            out += src[i] ?? '';
            i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n')
                i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/'))
                i++;
            i += 2;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}
/** Pull dependency names out of a single target's argument list. */
function extractTargetDependencies(targetBody) {
    const body = stripComments(targetBody);
    const depsKey = /(^|[,\s(])dependencies:\s*\[/.exec(body);
    if (!depsKey)
        return [];
    const bracketIndex = body.indexOf('[', depsKey.index);
    const list = sliceBalanced(body, bracketIndex, '[', ']');
    if (list === null)
        return [];
    const names = [];
    // Consume each qualified entry WHOLE — .product(name:package:) carries a
    // second string literal that must not be read back as a dependency.
    const qualified = /\.(?:target|byName|product)\(([^)]*)\)/g;
    let m;
    while ((m = qualified.exec(list)) !== null) {
        const name = /name:\s*"([^"]+)"/.exec(m[1]);
        if (name)
            names.push(name[1]);
    }
    // Bare "Name" entries — whatever the qualified forms did not claim.
    const withoutQualified = list.replace(qualified, '');
    const bare = /"([^"]+)"/g;
    while ((m = bare.exec(withoutQualified)) !== null)
        names.push(m[1]);
    return [...new Set(names)];
}
//# sourceMappingURL=code-scanner.js.map