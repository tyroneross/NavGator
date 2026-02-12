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
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
  ProjectMetadata,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

interface SwiftFileInfo {
  relativePath: string;
  content: string;
  lines: string[];
}

interface StringKeyHit {
  key: string;
  type: 'UserDefaults' | 'AppStorage' | 'NotificationCenter' | 'AssetName' | 'Keychain';
  file: string;
  line: number;
  symbol: string;
  snippet: string;
}

interface ProtocolConformance {
  typeName: string;
  protocols: string[];
  file: string;
  line: number;
}

interface StateObservation {
  propertyName: string;
  wrapper: string; // @Published, @EnvironmentObject, @StateObject, @ObservedObject, @AppStorage
  ownerType: string;
  file: string;
  line: number;
}

interface LLMApiCall {
  provider: string;
  url?: string;
  file: string;
  line: number;
  symbol: string;
  snippet: string;
}

// =============================================================================
// FRAMEWORK → ENTITLEMENT MAP
// =============================================================================

const FRAMEWORK_ENTITLEMENTS: Record<string, { entitlement?: string; plistKey?: string }> = {
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

const LLM_URL_PATTERNS: { pattern: RegExp; provider: string }[] = [
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
];

// Swift SDK import patterns for LLMs
const LLM_IMPORT_PATTERNS: { pattern: RegExp; provider: string }[] = [
  { pattern: /^import\s+OpenAI\b/, provider: 'OpenAI' },
  { pattern: /^import\s+Anthropic\b/, provider: 'Claude (Anthropic)' },
  { pattern: /^import\s+GoogleGenerativeAI\b/, provider: 'Gemini (Google)' },
  { pattern: /^import\s+FoundationModels\b/, provider: 'Apple Intelligence' },
];

// Swift SDK call patterns
const LLM_CALL_PATTERNS: { pattern: RegExp; provider: string }[] = [
  { pattern: /ChatQuery\(/, provider: 'OpenAI' },
  { pattern: /\.chats\(query:/, provider: 'OpenAI' },
  { pattern: /\.completions\.create\(/, provider: 'OpenAI' },
  { pattern: /AnthropicClient\(/, provider: 'Claude (Anthropic)' },
  { pattern: /\.messages\.create\(/, provider: 'Claude (Anthropic)' },
  { pattern: /GenerativeModel\(name:/, provider: 'Gemini (Google)' },
  { pattern: /\.generateContent\(/, provider: 'Gemini (Google)' },
  { pattern: /LanguageModelSession\(\)/, provider: 'Apple Intelligence' },
  { pattern: /\.respond\(to:/, provider: 'Apple Intelligence' },
  { pattern: /@Generable\b/, provider: 'Apple Intelligence' },
];

// =============================================================================
// MAIN SCANNER
// =============================================================================

export async function scanSwiftCode(projectRoot: string): Promise<ScanResult & { projectMeta: Partial<ProjectMetadata> }> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Load all Swift files
  const swiftFiles = await glob('**/*.swift', {
    cwd: projectRoot,
    ignore: ['.build/**', 'DerivedData/**', '.swiftpm/**', 'Pods/**', 'Carthage/**', '*.playground/**'],
  });

  const files: SwiftFileInfo[] = [];
  for (const relPath of swiftFiles) {
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

  // ---- String-keyed runtime deps ----
  const stringKeys = scanStringKeys(files);
  const fragileKeys = buildFragileKeys(stringKeys);

  // Create components + connections for shared keys
  const keyGroups = groupByKey(stringKeys);
  for (const [groupKey, hits] of keyGroups) {
    if (hits.length < 1) continue;
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
        from: { component_id: compId, location: { file: hit.file, line: hit.line } },
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
  const protocolMap = new Map<string, ProtocolConformance[]>();
  for (const c of conformances) {
    for (const proto of c.protocols) {
      if (!protocolMap.has(proto)) protocolMap.set(proto, []);
      protocolMap.get(proto)!.push(c);
    }
  }

  for (const [proto, conformers] of protocolMap) {
    if (conformers.length < 1) continue;
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
      connections.push({
        connection_id: generateConnectionId('conforms-to'),
        from: { component_id: generateComponentId('other', conf.typeName), location: { file: conf.file, line: conf.line } },
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
      if (con.ownerType !== pub.ownerType) continue;
      connections.push({
        connection_id: generateConnectionId('observes'),
        from: { component_id: generateComponentId('component', con.ownerType), location: { file: con.file, line: con.line } },
        to: { component_id: generateComponentId('component', pub.ownerType), location: { file: pub.file, line: pub.line } },
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

  // ---- LLM API calls ----
  const llmCalls = scanLLMCalls(files);
  for (const call of llmCalls) {
    const compId = generateComponentId('llm', call.provider);
    // Only add component if not already present
    if (!components.find(c => c.name === call.provider && c.type === 'llm')) {
      components.push({
        component_id: compId,
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
      });
    }

    connections.push({
      connection_id: generateConnectionId('service-call'),
      from: { component_id: generateComponentId('other', call.file), location: { file: call.file, line: call.line } },
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
      detected_from: 'swift-code-scanner',
      confidence: 0.9,
      timestamp,
      last_verified: timestamp,
    });
  }

  // ---- Entitlement requirements ----
  const frameworkImports = scanFrameworkImports(files);
  const entitlementReqs: { key: string; framework: string; file: string; line: number }[] = [];
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

  for (const req of entitlementReqs) {
    connections.push({
      connection_id: generateConnectionId('requires-entitlement'),
      from: { component_id: generateComponentId('framework', req.framework), location: { file: req.file, line: req.line } },
      to: { component_id: generateComponentId('other', `entitlement:${req.key}`) },
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
      from: { component_id: compId, location: { file: prompt.file, line: prompt.line } },
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

  // ---- Build project metadata ----
  const projectMeta = buildProjectMetadata(files, frameworkImports, projectRoot, fragileKeys, entitlementReqs);

  return { components, connections, warnings, projectMeta };
}

// =============================================================================
// STRING KEY DETECTION
// =============================================================================

function scanStringKeys(files: SwiftFileInfo[]): StringKeyHit[] {
  const hits: StringKeyHit[] = [];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

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

function scanProtocolConformance(files: SwiftFileInfo[]): ProtocolConformance[] {
  const conformances: ProtocolConformance[] = [];
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

function scanStateObservation(files: SwiftFileInfo[]): StateObservation[] {
  const observations: StateObservation[] = [];
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
        if (!line.includes(wrapper)) continue;
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

function scanLLMCalls(files: SwiftFileInfo[]): LLMApiCall[] {
  const calls: LLMApiCall[] = [];

  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // Check URL patterns in string literals
      for (const { pattern, provider } of LLM_URL_PATTERNS) {
        if (pattern.test(line)) {
          calls.push({
            provider,
            url: line.match(/"([^"]*)"/)?.[ 1],
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
  const seen = new Set<string>();
  return calls.filter(c => {
    const key = `${c.file}:${c.provider}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// =============================================================================
// FRAMEWORK IMPORT SCANNING (for entitlement detection)
// =============================================================================

function scanFrameworkImports(files: SwiftFileInfo[]): { framework: string; file: string; line: number }[] {
  const results: { framework: string; file: string; line: number }[] = [];
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
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.framework)) return false;
    seen.add(r.framework);
    return true;
  });
}

// =============================================================================
// PROMPT DETECTION IN SWIFT
// =============================================================================

function scanSwiftPrompts(files: SwiftFileInfo[]): { name: string; file: string; line: number; preview: string; confidence: number }[] {
  const prompts: { name: string; file: string; line: number; preview: string; confidence: number }[] = [];

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
          const nextLines: string[] = [];
          for (let j = i + 1; j < Math.min(i + 10, file.lines.length); j++) {
            if (file.lines[j].includes('"""')) break;
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

function buildProjectMetadata(
  files: SwiftFileInfo[],
  frameworkImports: { framework: string; file: string; line: number }[],
  projectRoot: string,
  fragileKeys: ProjectMetadata['fragile_keys'],
  entitlementReqs: { key: string; framework: string }[],
): Partial<ProjectMetadata> {
  const meta: Partial<ProjectMetadata> = { type: 'swift-app' };

  // Detect platforms from framework usage
  const platforms: Set<string> = new Set();
  const allImports = new Set<string>();
  for (const file of files) {
    for (const line of file.lines) {
      const m = line.match(/^\s*import\s+(\w+)/);
      if (m) allImports.add(m[1]);
    }
  }

  if (allImports.has('UIKit') || allImports.has('SwiftUI')) platforms.add('iOS');
  if (allImports.has('AppKit')) platforms.add('macOS');
  if (allImports.has('WatchKit')) platforms.add('watchOS');
  if (allImports.has('WidgetKit')) platforms.add('iOS'); // Widgets are iOS typically
  // SwiftUI can be any platform — check for platform-specific APIs
  if (allImports.has('SwiftUI') && !allImports.has('UIKit') && !allImports.has('AppKit')) {
    platforms.add('iOS'); // Default assumption for SwiftUI-only
    platforms.add('macOS');
  }
  meta.platforms = [...platforms] as ProjectMetadata['platforms'];

  // Detect architecture pattern
  if (allImports.has('ComposableArchitecture')) {
    meta.architecture_pattern = 'TCA (Composable Architecture)';
  } else {
    // Check for MVVM indicators: ObservableObject/Observable classes separate from Views
    const hasObservableObjects = files.some(f => f.content.includes('ObservableObject') || f.content.includes('@Observable'));
    const hasViews = files.some(f => f.content.includes(': View'));
    if (hasObservableObjects && hasViews) {
      meta.architecture_pattern = 'MVVM';
    } else if (allImports.has('UIKit') && files.some(f => f.content.includes(': UIViewController'))) {
      meta.architecture_pattern = 'MVC';
    }
  }

  // Detect deployment target from Package.swift
  try {
    const pkgSwiftPath = path.join(projectRoot, 'Package.swift');
    if (fs.existsSync(pkgSwiftPath)) {
      const pkgContent = fs.readFileSync(pkgSwiftPath, 'utf-8');
      const deployments: Record<string, string> = {};
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
  } catch {
    // Skip if unreadable
  }

  // Parse targets from Package.swift
  try {
    const pkgSwiftPath = path.join(projectRoot, 'Package.swift');
    if (fs.existsSync(pkgSwiftPath)) {
      const pkgContent = fs.readFileSync(pkgSwiftPath, 'utf-8');
      const targets: ProjectMetadata['targets'] = [];
      const targetMatches = pkgContent.matchAll(/\.(?:executableTarget|target|testTarget)\(\s*name:\s*"([^"]+)"/g);
      for (const m of targetMatches) {
        const targetType = m[0].includes('testTarget') ? 'test' : m[0].includes('executableTarget') ? 'executable' : 'library';
        targets.push({ name: m[1], type: targetType, dependencies: [] });
      }
      if (targets.length > 0) {
        meta.targets = targets;
      }
    }
  } catch {
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

function extractNearestSymbol(lines: string[], lineIndex: number): string | undefined {
  // Look backwards for func/var/let/class/struct declaration
  for (let j = lineIndex; j >= Math.max(0, lineIndex - 5); j--) {
    const funcMatch = lines[j].match(/(?:func|var|let|class|struct|enum)\s+(\w+)/);
    if (funcMatch) return funcMatch[1];
  }
  return undefined;
}

function groupByKey(hits: StringKeyHit[]): Map<string, StringKeyHit[]> {
  const groups = new Map<string, StringKeyHit[]>();
  for (const hit of hits) {
    const key = `${hit.type}:${hit.key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(hit);
  }
  return groups;
}

function buildFragileKeys(hits: StringKeyHit[]): ProjectMetadata['fragile_keys'] {
  const groups = groupByKey(hits);
  const fragile: NonNullable<ProjectMetadata['fragile_keys']> = [];
  for (const [key, keyHits] of groups) {
    fragile.push({
      key,
      type: keyHits[0].type,
      files: [...new Set(keyHits.map(h => h.file))],
    });
  }
  return fragile.length > 0 ? fragile : undefined;
}
