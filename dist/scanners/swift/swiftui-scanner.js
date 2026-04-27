/**
 * SwiftUI View Scanner
 * Parses SwiftUI view bodies, modifier chains, and navigation structure.
 * Detects:
 * - View composition (which views are used inside other views)
 * - Modifier chains (especially accessibility modifiers)
 * - Navigation flow (NavigationLink, .sheet, .fullScreenCover, .popover, .navigationDestination)
 * - Environment dependencies (@Environment, @EnvironmentObject)
 */
import { generateComponentId, generateConnectionId, } from '../../types.js';
// =============================================================================
// WELL-KNOWN SWIFTUI TYPES (to filter from composed views)
// =============================================================================
const BUILTIN_VIEWS = new Set([
    // Layout
    'VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'LazyVGrid', 'LazyHGrid',
    'Grid', 'GridRow', 'Spacer', 'Divider', 'GeometryReader', 'ScrollView',
    // Controls
    'Button', 'Toggle', 'Slider', 'Stepper', 'Picker', 'DatePicker', 'ColorPicker',
    'Menu', 'Link', 'Label', 'ProgressView', 'Gauge',
    // Text
    'Text', 'TextField', 'TextEditor', 'SecureField',
    // Images
    'Image', 'AsyncImage',
    // Lists
    'List', 'ForEach', 'Section', 'DisclosureGroup', 'OutlineGroup',
    // Navigation
    'NavigationStack', 'NavigationSplitView', 'NavigationLink', 'TabView', 'Tab',
    // Containers
    'Group', 'Form', 'GroupBox', 'ControlGroup',
    // Sheets/Overlays
    'Sheet', 'Alert', 'ConfirmationDialog',
    // Shapes
    'Rectangle', 'RoundedRectangle', 'Circle', 'Ellipse', 'Capsule', 'Path',
    // Effects
    'Color', 'LinearGradient', 'RadialGradient', 'AngularGradient',
    // Other
    'EmptyView', 'AnyView', 'TupleView', 'TimelineView', 'Canvas',
    'Map', 'Chart', 'ShareLink', 'PhotosPicker',
]);
// =============================================================================
// MAIN SCANNER
// =============================================================================
export function scanSwiftUIViews(files) {
    const views = [];
    const navigationLinks = [];
    const components = [];
    const connections = [];
    const timestamp = Date.now();
    // Phase 1: Find all View-conforming structs and extract their bodies
    for (const file of files) {
        const fileViews = extractViews(file);
        views.push(...fileViews);
    }
    // Phase 2: Parse navigation structure across all files
    for (const file of files) {
        const navLinks = parseNavigationStructure(file, views);
        navigationLinks.push(...navLinks);
    }
    // Phase 3: Convert to architecture components/connections
    const viewNameSet = new Set(views.map(v => v.name));
    for (const view of views) {
        const compId = generateComponentId('component', view.name);
        components.push({
            component_id: compId,
            name: view.name,
            type: 'component',
            role: {
                purpose: `SwiftUI view${view.hasNavigationStack ? ' (navigation root)' : ''}`,
                layer: 'frontend',
                critical: view.hasNavigationStack,
            },
            source: {
                detection_method: 'auto',
                config_files: [],
                confidence: 0.9,
            },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: [
                'swift',
                'swiftui',
                'view',
                ...(view.hasNavigationStack ? ['navigation-root'] : []),
                ...(view.environmentDeps.length > 0 ? ['uses-environment'] : []),
            ],
            metadata: {
                composedViews: view.composedViews,
                modifierCount: view.modifiers.length,
                a11yModifiers: view.modifiers
                    .filter(m => m.name.startsWith('accessibility'))
                    .map(m => m.name),
                environmentDeps: view.environmentDeps,
            },
            timestamp,
            last_updated: timestamp,
        });
        // Composed view connections (view A uses view B)
        for (const childName of view.composedViews) {
            if (viewNameSet.has(childName)) {
                connections.push({
                    connection_id: generateConnectionId('imports'),
                    from: {
                        component_id: compId,
                        location: { file: view.file, line: view.line },
                    },
                    to: {
                        component_id: generateComponentId('component', childName),
                    },
                    connection_type: 'imports',
                    code_reference: {
                        file: view.file,
                        symbol: view.name,
                        symbol_type: 'class',
                        line_start: view.line,
                        code_snippet: `${view.name} uses ${childName}`,
                    },
                    description: `${view.name} composes ${childName}`,
                    detected_from: 'swiftui-scanner',
                    confidence: 0.85,
                    timestamp,
                    last_verified: timestamp,
                });
            }
        }
    }
    // Navigation connections
    for (const nav of navigationLinks) {
        const connType = nav.type === 'sheet' || nav.type === 'fullScreenCover' || nav.type === 'popover'
            ? 'presents'
            : 'navigates-to';
        connections.push({
            connection_id: generateConnectionId(connType),
            from: {
                component_id: generateComponentId('component', nav.sourceView),
                location: { file: nav.file, line: nav.line },
            },
            to: {
                component_id: generateComponentId('component', nav.destinationView),
            },
            connection_type: connType,
            code_reference: {
                file: nav.file,
                symbol: nav.sourceView,
                symbol_type: 'class',
                line_start: nav.line,
                code_snippet: `${nav.type}: ${nav.sourceView} → ${nav.destinationView}`,
            },
            description: `${nav.sourceView} ${nav.type === 'link' ? 'navigates to' : 'presents'} ${nav.destinationView}`,
            detected_from: 'swiftui-scanner',
            confidence: 0.8,
            timestamp,
            last_verified: timestamp,
        });
    }
    return { views, navigationLinks, components, connections };
}
// =============================================================================
// VIEW EXTRACTION
// =============================================================================
/**
 * Extract brace-balanced content starting from a line that contains '{'.
 * Returns the content between the first '{' on startLine and its matching '}'.
 */
function extractBraceContent(lines, startLine, endBound) {
    let depth = 0;
    let started = false;
    const bodyLines = [];
    let openLine = -1;
    for (let i = startLine; i <= endBound && i < lines.length; i++) {
        for (let k = 0; k < lines[i].length; k++) {
            if (lines[i][k] === '{') {
                depth++;
                if (!started) {
                    started = true;
                    openLine = i;
                }
            }
            else if (lines[i][k] === '}') {
                depth--;
                if (depth === 0 && started) {
                    // Collect lines between open and close braces
                    for (let l = openLine + 1; l < i; l++) {
                        bodyLines.push(lines[l]);
                    }
                    const beforeClose = lines[i].substring(0, k).trim();
                    if (beforeClose)
                        bodyLines.push(beforeClose);
                    return bodyLines.join('\n');
                }
            }
        }
    }
    return null;
}
function extractViews(file) {
    const views = [];
    const { lines, content, relativePath } = file;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match: struct SomeName: View {
        // Also: struct SomeName: View, SomeProtocol {
        const viewMatch = line.match(/^\s*(?:(?:public|private|internal|fileprivate)\s+)?struct\s+(\w+)\s*(?:<[^>]*>)?\s*:\s*([^{]+)\{/);
        if (!viewMatch)
            continue;
        const viewName = viewMatch[1];
        const protocols = viewMatch[2].split(',').map(p => p.trim());
        if (!protocols.includes('View'))
            continue;
        // Find struct bounds for scanning additional patterns
        const structBounds = findStructBounds(lines, i);
        if (!structBounds)
            continue;
        // Extract body content using brace-balanced parser
        const bodyContent = extractViewBody(content, viewName, lines, i);
        // Collect composed views from body + additional view-returning members
        const allComposedViews = new Set();
        let allBodyContent = '';
        if (bodyContent) {
            allBodyContent = bodyContent;
            for (const v of parseViewComposition(bodyContent)) {
                allComposedViews.add(v);
            }
        }
        // Scan struct body for additional view-returning patterns
        const additionalBodies = extractAdditionalViewBodies(lines, structBounds.start, structBounds.end);
        for (const extra of additionalBodies) {
            allBodyContent += '\n' + extra;
            for (const v of parseViewComposition(extra)) {
                allComposedViews.add(v);
            }
        }
        if (!bodyContent && additionalBodies.length === 0)
            continue;
        // Parse modifier chains
        const modifiers = parseModifierChain(allBodyContent, i);
        // Check for NavigationStack/NavigationView
        const hasNavigationStack = /NavigationStack|NavigationView/.test(allBodyContent);
        // Parse environment dependencies
        const environmentDeps = parseEnvironmentDeps(lines, i);
        views.push({
            name: viewName,
            file: relativePath,
            line: i + 1,
            composedViews: [...allComposedViews],
            modifiers,
            hasNavigationStack,
            environmentDeps,
        });
    }
    return views;
}
/**
 * Find the brace-balanced bounds of a struct starting at structLine.
 */
function findStructBounds(lines, structLine) {
    let braceDepth = 0;
    let structStart = -1;
    let structEnd = -1;
    for (let i = structLine; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') {
                if (structStart === -1)
                    structStart = i;
                braceDepth++;
            }
            else if (ch === '}') {
                braceDepth--;
                if (braceDepth === 0 && structStart !== -1) {
                    structEnd = i;
                    break;
                }
            }
        }
        if (structEnd !== -1)
            break;
    }
    if (structStart === -1 || structEnd === -1)
        return null;
    return { start: structStart, end: structEnd };
}
/**
 * Scan inside a struct body for additional view-returning patterns:
 * 1. @ViewBuilder functions: @ViewBuilder func foo(...) -> some View { }
 * 2. View-returning functions: func foo(...) -> some View { }
 * 3. Computed view properties: var content: some View { }
 *
 * Returns the extracted body content of each match.
 */
function extractAdditionalViewBodies(lines, structStart, structEnd) {
    const bodies = [];
    // Track brace depth to only match at struct-level (depth 1)
    let depth = 0;
    for (let i = structStart; i <= structEnd; i++) {
        for (const ch of lines[i]) {
            if (ch === '{')
                depth++;
            if (ch === '}')
                depth--;
        }
        // Only scan members at struct body level (depth 1 after counting this line)
        // We look ahead at the next line patterns
        if (i >= structEnd)
            break;
        const line = lines[i];
        // Skip the `var body: some View` line -- already handled by extractViewBody
        if (/var\s+body\s*:\s*some\s+View\s*\{/.test(line))
            continue;
        // Pattern 1 & 2: @ViewBuilder func or func ... -> some View {
        // @ViewBuilder may be on the same line or the line before
        const isViewBuilder = /@ViewBuilder/.test(line) ||
            (i > structStart && /@ViewBuilder/.test(lines[i - 1]));
        const funcViewMatch = line.match(/(?:(?:public|private|internal|open|static|@ViewBuilder)\s+)*func\s+\w+\s*\([^)]*\)\s*->\s*some\s+View\s*\{/);
        if (funcViewMatch || (isViewBuilder && /func\s+\w+/.test(line) && /\{/.test(line))) {
            const body = extractBraceContent(lines, i, structEnd);
            if (body)
                bodies.push(body);
            continue;
        }
        // Also handle @ViewBuilder on previous line, func on current line
        if (i > structStart && /@ViewBuilder/.test(lines[i - 1]) && !/@ViewBuilder/.test(line)) {
            const funcMatch = line.match(/func\s+\w+\s*\([^)]*\)\s*(->\s*some\s+View\s*)?\{/);
            if (funcMatch) {
                const body = extractBraceContent(lines, i, structEnd);
                if (body)
                    bodies.push(body);
                continue;
            }
        }
        // Pattern 3: Computed view properties (not `body`)
        // var someProperty: some View {
        const computedViewMatch = line.match(/var\s+(\w+)\s*:\s*some\s+View\s*\{/);
        if (computedViewMatch && computedViewMatch[1] !== 'body') {
            const body = extractBraceContent(lines, i, structEnd);
            if (body)
                bodies.push(body);
        }
    }
    return bodies;
}
/**
 * Extract the body property content of a SwiftUI view using brace-balanced parsing.
 * Looks for `var body: some View {` inside the struct and extracts its content.
 */
function extractViewBody(_content, _viewName, lines, structLine) {
    const bounds = findStructBounds(lines, structLine);
    if (!bounds)
        return null;
    // Within the struct, find `var body: some View {`
    for (let i = bounds.start; i <= bounds.end; i++) {
        const bodyMatch = lines[i].match(/var\s+body\s*:\s*some\s+View\s*\{/);
        if (!bodyMatch)
            continue;
        return extractBraceContent(lines, i, bounds.end);
    }
    return null;
}
// =============================================================================
// VIEW COMPOSITION PARSING
// =============================================================================
/**
 * Detect custom view usages within body content.
 * Looks for `SomeView()` or `SomeView(param:)` patterns.
 */
function parseViewComposition(bodyContent) {
    const views = new Set();
    // Match PascalCase identifiers followed by ( or {
    // This catches: MyCustomView(), MyView(arg: value), MyView { ... }
    const viewCallPattern = /\b([A-Z][a-zA-Z0-9]+)\s*(?:\(|\{)/g;
    let match;
    while ((match = viewCallPattern.exec(bodyContent)) !== null) {
        const name = match[1];
        if (!BUILTIN_VIEWS.has(name) && !isSwiftKeyword(name)) {
            views.add(name);
        }
    }
    return [...views];
}
function isSwiftKeyword(name) {
    const keywords = new Set([
        'String', 'Int', 'Double', 'Float', 'Bool', 'Array', 'Dictionary',
        'Optional', 'Set', 'Date', 'URL', 'UUID', 'Data', 'Error',
        'Task', 'Result', 'Binding', 'State', 'Published', 'Environment',
        'CGFloat', 'CGPoint', 'CGSize', 'CGRect',
        'AnyObject', 'AnyHashable', 'Never', 'Void',
        'DispatchQueue', 'NotificationCenter', 'UserDefaults',
        'NSObject', 'NSError', 'Timer',
    ]);
    return keywords.has(name);
}
// =============================================================================
// MODIFIER CHAIN PARSING
// =============================================================================
/**
 * Parse .modifier() chains from body content.
 * Especially interested in accessibility modifiers.
 */
function parseModifierChain(bodyContent, baseLineOffset) {
    const modifiers = [];
    const bodyLines = bodyContent.split('\n');
    for (let i = 0; i < bodyLines.length; i++) {
        const line = bodyLines[i];
        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*'))
            continue;
        // Match .modifierName(args) patterns
        const modPattern = /\.(\w+)\(([^)]*)\)/g;
        let match;
        while ((match = modPattern.exec(line)) !== null) {
            const modName = match[1];
            const modArgs = match[2].trim();
            // Filter to interesting modifiers
            if (isInterestingModifier(modName)) {
                modifiers.push({
                    name: modName,
                    args: modArgs.slice(0, 100),
                    line: baseLineOffset + i + 1,
                });
            }
        }
    }
    return modifiers;
}
function isInterestingModifier(name) {
    // Accessibility modifiers
    if (name.startsWith('accessibility'))
        return true;
    // Navigation modifiers
    if (['navigationTitle', 'navigationBarTitleDisplayMode', 'navigationDestination',
        'toolbar', 'toolbarItem', 'searchable'].includes(name))
        return true;
    // Presentation modifiers
    if (['sheet', 'fullScreenCover', 'popover', 'alert', 'confirmationDialog'].includes(name))
        return true;
    // Layout modifiers of interest
    if (['frame', 'padding', 'overlay', 'background'].includes(name))
        return true;
    // Task modifier
    if (name === 'task' || name === 'onAppear' || name === 'onDisappear')
        return true;
    return false;
}
// =============================================================================
// NAVIGATION STRUCTURE PARSING
// =============================================================================
/**
 * Detect navigation relationships across files.
 */
function parseNavigationStructure(file, allViews) {
    const links = [];
    const { lines, relativePath } = file;
    const viewNames = new Set(allViews.map(v => v.name));
    // Track current view context
    let currentView = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*'))
            continue;
        // Track current struct context
        const structMatch = line.match(/struct\s+(\w+)\s*.*:\s*.*View/);
        if (structMatch) {
            currentView = structMatch[1];
        }
        if (!currentView)
            continue;
        // NavigationLink(destination: SomeView()) { ... }
        const navLinkDest = line.match(/NavigationLink\s*\(\s*destination:\s*(\w+)\s*\(/);
        if (navLinkDest && viewNames.has(navLinkDest[1])) {
            links.push({
                sourceView: currentView,
                destinationView: navLinkDest[1],
                type: 'link',
                file: relativePath,
                line: i + 1,
            });
        }
        // NavigationLink { SomeView() } label: { ... }
        // NavigationLink(value: ...) { ... }
        // These are harder to parse — look for NavigationLink followed by a view name
        if (/NavigationLink/.test(line) && !navLinkDest) {
            // Check next few lines for a destination view
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const destMatch = lines[j].match(/\b([A-Z][a-zA-Z0-9]+)\s*\(/);
                if (destMatch && viewNames.has(destMatch[1]) && destMatch[1] !== currentView) {
                    links.push({
                        sourceView: currentView,
                        destinationView: destMatch[1],
                        type: 'link',
                        file: relativePath,
                        line: i + 1,
                    });
                    break;
                }
            }
        }
        // .navigationDestination(for: SomeType.self) { value in SomeView(value) }
        const navDestMatch = line.match(/\.navigationDestination\(for:\s*(\w+)\.self\)/);
        if (navDestMatch) {
            // Look ahead for destination view
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const viewMatch = lines[j].match(/\b([A-Z][a-zA-Z0-9]+)\s*\(/);
                if (viewMatch && viewNames.has(viewMatch[1]) && viewMatch[1] !== currentView) {
                    links.push({
                        sourceView: currentView,
                        destinationView: viewMatch[1],
                        type: 'destination',
                        file: relativePath,
                        line: i + 1,
                    });
                    break;
                }
            }
        }
        // .sheet(isPresented: ...) { SomeView() }
        const sheetMatch = line.match(/\.sheet\s*\(/);
        if (sheetMatch) {
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const viewMatch = lines[j].match(/\b([A-Z][a-zA-Z0-9]+)\s*\(/);
                if (viewMatch && viewNames.has(viewMatch[1]) && viewMatch[1] !== currentView) {
                    links.push({
                        sourceView: currentView,
                        destinationView: viewMatch[1],
                        type: 'sheet',
                        file: relativePath,
                        line: i + 1,
                    });
                    break;
                }
            }
        }
        // .fullScreenCover(isPresented: ...) { SomeView() }
        const coverMatch = line.match(/\.fullScreenCover\s*\(/);
        if (coverMatch) {
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const viewMatch = lines[j].match(/\b([A-Z][a-zA-Z0-9]+)\s*\(/);
                if (viewMatch && viewNames.has(viewMatch[1]) && viewMatch[1] !== currentView) {
                    links.push({
                        sourceView: currentView,
                        destinationView: viewMatch[1],
                        type: 'fullScreenCover',
                        file: relativePath,
                        line: i + 1,
                    });
                    break;
                }
            }
        }
        // .popover(isPresented: ...) { SomeView() }
        const popoverMatch = line.match(/\.popover\s*\(/);
        if (popoverMatch) {
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const viewMatch = lines[j].match(/\b([A-Z][a-zA-Z0-9]+)\s*\(/);
                if (viewMatch && viewNames.has(viewMatch[1]) && viewMatch[1] !== currentView) {
                    links.push({
                        sourceView: currentView,
                        destinationView: viewMatch[1],
                        type: 'popover',
                        file: relativePath,
                        line: i + 1,
                    });
                    break;
                }
            }
        }
    }
    return links;
}
// =============================================================================
// ENVIRONMENT DEPENDENCY PARSING
// =============================================================================
/**
 * Find @Environment and @EnvironmentObject properties in a view struct.
 */
function parseEnvironmentDeps(lines, structLine) {
    const deps = [];
    let braceDepth = 0;
    let started = false;
    for (let i = structLine; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') {
                braceDepth++;
                started = true;
            }
            if (ch === '}')
                braceDepth--;
        }
        if (started && braceDepth === 0)
            break;
        // @Environment(\.keyPath) var name
        const envMatch = lines[i].match(/@Environment\(\\\.([\w.]+)\)/);
        if (envMatch) {
            deps.push(envMatch[1]);
        }
        // @EnvironmentObject var name: Type
        const envObjMatch = lines[i].match(/@EnvironmentObject\s+(?:private\s+)?var\s+\w+\s*:\s*(\w+)/);
        if (envObjMatch) {
            deps.push(envObjMatch[1]);
        }
    }
    return deps;
}
//# sourceMappingURL=swiftui-scanner.js.map