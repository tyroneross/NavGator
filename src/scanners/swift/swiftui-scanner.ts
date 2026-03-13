/**
 * SwiftUI View Scanner
 * Parses SwiftUI view bodies, modifier chains, and navigation structure.
 * Detects:
 * - View composition (which views are used inside other views)
 * - Modifier chains (especially accessibility modifiers)
 * - Navigation flow (NavigationLink, .sheet, .fullScreenCover, .popover, .navigationDestination)
 * - Environment dependencies (@Environment, @EnvironmentObject)
 */

import {
  ArchitectureComponent,
  ArchitectureConnection,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

interface SwiftFileInfo {
  relativePath: string;
  content: string;
  lines: string[];
}

export interface SwiftUIViewInfo {
  name: string;
  file: string;
  line: number;
  composedViews: string[];
  modifiers: ViewModifier[];
  hasNavigationStack: boolean;
  environmentDeps: string[];
}

export interface ViewModifier {
  name: string;
  args: string;
  line: number;
}

export interface NavigationLink {
  sourceView: string;
  destinationView: string;
  type: 'link' | 'destination' | 'sheet' | 'fullScreenCover' | 'popover';
  file: string;
  line: number;
}

export interface SwiftUIResult {
  views: SwiftUIViewInfo[];
  navigationLinks: NavigationLink[];
  components: ArchitectureComponent[];
  connections: ArchitectureConnection[];
}

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

export function scanSwiftUIViews(files: SwiftFileInfo[]): SwiftUIResult {
  const views: SwiftUIViewInfo[] = [];
  const navigationLinks: NavigationLink[] = [];
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
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
      ? 'presents' as const
      : 'navigates-to' as const;

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

function extractViews(file: SwiftFileInfo): SwiftUIViewInfo[] {
  const views: SwiftUIViewInfo[] = [];
  const { lines, content, relativePath } = file;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: struct SomeName: View {
    // Also: struct SomeName: View, SomeProtocol {
    const viewMatch = line.match(
      /^\s*(?:(?:public|private|internal|fileprivate)\s+)?struct\s+(\w+)\s*(?:<[^>]*>)?\s*:\s*([^{]+)\{/
    );
    if (!viewMatch) continue;

    const viewName = viewMatch[1];
    const protocols = viewMatch[2].split(',').map(p => p.trim());

    if (!protocols.includes('View')) continue;

    // Extract body content using brace-balanced parser
    const bodyContent = extractViewBody(content, viewName, lines, i);
    if (!bodyContent) continue;

    // Parse composed views from body
    const composedViews = parseViewComposition(bodyContent);

    // Parse modifier chains
    const modifiers = parseModifierChain(bodyContent, i);

    // Check for NavigationStack/NavigationView
    const hasNavigationStack = /NavigationStack|NavigationView/.test(bodyContent);

    // Parse environment dependencies
    const environmentDeps = parseEnvironmentDeps(lines, i);

    views.push({
      name: viewName,
      file: relativePath,
      line: i + 1,
      composedViews,
      modifiers,
      hasNavigationStack,
      environmentDeps,
    });
  }

  return views;
}

/**
 * Extract the body property content of a SwiftUI view using brace-balanced parsing.
 * Looks for `var body: some View {` inside the struct and extracts its content.
 */
function extractViewBody(
  content: string,
  _viewName: string,
  lines: string[],
  structLine: number
): string | null {
  // Find the struct's opening brace
  let braceDepth = 0;
  let structStart = -1;
  let structEnd = -1;

  for (let i = structLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        if (structStart === -1) structStart = i;
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0 && structStart !== -1) {
          structEnd = i;
          break;
        }
      }
    }
    if (structEnd !== -1) break;
  }

  if (structStart === -1 || structEnd === -1) return null;

  // Within the struct, find `var body: some View {`
  for (let i = structStart; i <= structEnd; i++) {
    const bodyMatch = lines[i].match(/var\s+body\s*:\s*some\s+View\s*\{/);
    if (!bodyMatch) continue;

    // Extract body content using brace balancing
    let bodyDepth = 0;
    let bodyStart = -1;
    const bodyLines: string[] = [];

    for (let j = i; j <= structEnd; j++) {
      for (let k = 0; k < lines[j].length; k++) {
        if (lines[j][k] === '{') {
          if (bodyStart === -1) bodyStart = j;
          bodyDepth++;
        } else if (lines[j][k] === '}') {
          bodyDepth--;
          if (bodyDepth === 0 && bodyStart !== -1) {
            // Collect all lines between body braces
            for (let l = bodyStart + 1; l < j; l++) {
              bodyLines.push(lines[l]);
            }
            // Include partial last line if content before closing brace
            const beforeClose = lines[j].substring(0, k).trim();
            if (beforeClose) bodyLines.push(beforeClose);
            return bodyLines.join('\n');
          }
        }
      }
    }
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
function parseViewComposition(bodyContent: string): string[] {
  const views = new Set<string>();

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

function isSwiftKeyword(name: string): boolean {
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
function parseModifierChain(bodyContent: string, baseLineOffset: number): ViewModifier[] {
  const modifiers: ViewModifier[] = [];
  const bodyLines = bodyContent.split('\n');

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

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

function isInterestingModifier(name: string): boolean {
  // Accessibility modifiers
  if (name.startsWith('accessibility')) return true;

  // Navigation modifiers
  if (['navigationTitle', 'navigationBarTitleDisplayMode', 'navigationDestination',
       'toolbar', 'toolbarItem', 'searchable'].includes(name)) return true;

  // Presentation modifiers
  if (['sheet', 'fullScreenCover', 'popover', 'alert', 'confirmationDialog'].includes(name)) return true;

  // Layout modifiers of interest
  if (['frame', 'padding', 'overlay', 'background'].includes(name)) return true;

  // Task modifier
  if (name === 'task' || name === 'onAppear' || name === 'onDisappear') return true;

  return false;
}

// =============================================================================
// NAVIGATION STRUCTURE PARSING
// =============================================================================

/**
 * Detect navigation relationships across files.
 */
function parseNavigationStructure(
  file: SwiftFileInfo,
  allViews: SwiftUIViewInfo[]
): NavigationLink[] {
  const links: NavigationLink[] = [];
  const { lines, relativePath } = file;
  const viewNames = new Set(allViews.map(v => v.name));

  // Track current view context
  let currentView = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Track current struct context
    const structMatch = line.match(/struct\s+(\w+)\s*.*:\s*.*View/);
    if (structMatch) {
      currentView = structMatch[1];
    }

    if (!currentView) continue;

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
function parseEnvironmentDeps(lines: string[], structLine: number): string[] {
  const deps: string[] = [];
  let braceDepth = 0;
  let started = false;

  for (let i = structLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { braceDepth++; started = true; }
      if (ch === '}') braceDepth--;
    }
    if (started && braceDepth === 0) break;

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
