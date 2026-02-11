/**
 * Swift Package Scanner
 * Detects packages from Package.swift, Podfile, and framework imports in .swift files
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ComponentType,
  generateComponentId,
  ScanResult,
  ScanWarning,
} from '../../types.js';

// =============================================================================
// FRAMEWORK SIGNATURES
// =============================================================================

interface FrameworkSignature {
  packageName: string;
  type: ComponentType;
  layer: 'frontend' | 'backend' | 'database' | 'queue' | 'infra' | 'external';
  purpose: string;
  critical: boolean;
}

const SWIFT_FRAMEWORK_SIGNATURES: FrameworkSignature[] = [
  // UI Frameworks
  { packageName: 'SwiftUI', type: 'framework', layer: 'frontend', purpose: 'SwiftUI declarative UI', critical: true },
  { packageName: 'UIKit', type: 'framework', layer: 'frontend', purpose: 'UIKit UI framework (iOS)', critical: true },
  { packageName: 'AppKit', type: 'framework', layer: 'frontend', purpose: 'AppKit UI framework (macOS)', critical: true },
  { packageName: 'WatchKit', type: 'framework', layer: 'frontend', purpose: 'WatchKit UI framework (watchOS)', critical: true },
  { packageName: 'WidgetKit', type: 'framework', layer: 'frontend', purpose: 'WidgetKit extensions', critical: false },

  // Architecture
  { packageName: 'ComposableArchitecture', type: 'framework', layer: 'frontend', purpose: 'TCA state management', critical: true },
  { packageName: 'Combine', type: 'framework', layer: 'backend', purpose: 'Reactive programming', critical: false },
  { packageName: 'Observation', type: 'framework', layer: 'backend', purpose: 'Observation framework', critical: false },

  // Networking
  { packageName: 'Alamofire', type: 'spm', layer: 'backend', purpose: 'HTTP networking library', critical: false },
  { packageName: 'Moya', type: 'spm', layer: 'backend', purpose: 'Network abstraction layer', critical: false },
  { packageName: 'URLSession', type: 'framework', layer: 'backend', purpose: 'Apple networking', critical: false },

  // Database / Persistence
  { packageName: 'CoreData', type: 'database', layer: 'database', purpose: 'Apple Core Data ORM', critical: true },
  { packageName: 'SwiftData', type: 'database', layer: 'database', purpose: 'Apple SwiftData persistence', critical: true },
  { packageName: 'RealmSwift', type: 'database', layer: 'database', purpose: 'Realm mobile database', critical: true },
  { packageName: 'GRDB', type: 'database', layer: 'database', purpose: 'SQLite toolkit for Swift', critical: true },
  { packageName: 'SQLite', type: 'database', layer: 'database', purpose: 'SQLite.swift wrapper', critical: true },
  { packageName: 'CSQLite', type: 'database', layer: 'database', purpose: 'C SQLite library', critical: true },
  { packageName: 'FMDB', type: 'database', layer: 'database', purpose: 'Objective-C SQLite wrapper', critical: true },

  // Cloud / External Services
  { packageName: 'CloudKit', type: 'service', layer: 'external', purpose: 'iCloud sync', critical: true },
  { packageName: 'FirebaseFirestore', type: 'service', layer: 'external', purpose: 'Firebase Firestore', critical: true },
  { packageName: 'FirebaseAuth', type: 'service', layer: 'external', purpose: 'Firebase authentication', critical: true },
  { packageName: 'FirebaseAnalytics', type: 'service', layer: 'external', purpose: 'Firebase analytics', critical: false },
  { packageName: 'FirebaseMessaging', type: 'service', layer: 'external', purpose: 'Firebase push notifications', critical: false },

  // AI / ML
  { packageName: 'CoreML', type: 'framework', layer: 'backend', purpose: 'Apple on-device ML', critical: false },
  { packageName: 'CreateML', type: 'framework', layer: 'backend', purpose: 'Apple ML training', critical: false },
  { packageName: 'NaturalLanguage', type: 'framework', layer: 'backend', purpose: 'Apple NLP framework', critical: false },
  { packageName: 'Vision', type: 'framework', layer: 'backend', purpose: 'Apple computer vision', critical: false },
  { packageName: 'OpenAI', type: 'service', layer: 'external', purpose: 'OpenAI Swift SDK', critical: true },

  // Payments / In-App Purchase
  { packageName: 'StoreKit', type: 'service', layer: 'external', purpose: 'Apple StoreKit in-app purchases', critical: true },
  { packageName: 'StripeKit', type: 'service', layer: 'external', purpose: 'Stripe payments (Swift)', critical: true },
  { packageName: 'RevenueCat', type: 'service', layer: 'external', purpose: 'RevenueCat subscriptions', critical: true },

  // Notifications
  { packageName: 'UserNotifications', type: 'framework', layer: 'backend', purpose: 'Push/local notifications', critical: false },
  { packageName: 'OneSignalFramework', type: 'service', layer: 'external', purpose: 'OneSignal push notifications', critical: false },

  // Image / Media
  { packageName: 'Kingfisher', type: 'spm', layer: 'frontend', purpose: 'Image downloading/caching', critical: false },
  { packageName: 'SDWebImageSwiftUI', type: 'spm', layer: 'frontend', purpose: 'Async image loading', critical: false },
  { packageName: 'AVFoundation', type: 'framework', layer: 'backend', purpose: 'Audio/video framework', critical: false },
  { packageName: 'PhotosUI', type: 'framework', layer: 'frontend', purpose: 'Photo picker UI', critical: false },

  // JSON / Serialization
  { packageName: 'SwiftyJSON', type: 'spm', layer: 'backend', purpose: 'JSON parsing', critical: false },

  // Logging / Analytics
  { packageName: 'SwiftyBeaver', type: 'spm', layer: 'backend', purpose: 'Logging framework', critical: false },
  { packageName: 'Sentry', type: 'service', layer: 'external', purpose: 'Error tracking', critical: false },
  { packageName: 'Mixpanel', type: 'service', layer: 'external', purpose: 'Product analytics', critical: false },
  { packageName: 'Amplitude', type: 'service', layer: 'external', purpose: 'Product analytics', critical: false },

  // Testing
  { packageName: 'Quick', type: 'spm', layer: 'backend', purpose: 'BDD testing framework', critical: false },
  { packageName: 'Nimble', type: 'spm', layer: 'backend', purpose: 'Matcher framework', critical: false },
  { packageName: 'SnapshotTesting', type: 'spm', layer: 'backend', purpose: 'Snapshot testing', critical: false },

  // Security / Auth
  { packageName: 'KeychainAccess', type: 'spm', layer: 'backend', purpose: 'Keychain wrapper', critical: false },
  { packageName: 'Security', type: 'framework', layer: 'backend', purpose: 'Apple Security framework', critical: false },

  // System
  { packageName: 'Foundation', type: 'framework', layer: 'backend', purpose: 'Apple Foundation framework', critical: false },
  { packageName: 'os', type: 'framework', layer: 'backend', purpose: 'Apple os logging', critical: false },
];

// =============================================================================
// DETECTION
// =============================================================================

/**
 * Check if this is a Swift/Xcode project
 */
export function detectSpm(projectRoot: string): boolean {
  if (
    fs.existsSync(path.join(projectRoot, 'Package.swift')) ||
    fs.existsSync(path.join(projectRoot, 'Podfile')) ||
    fs.existsSync(path.join(projectRoot, 'Cartfile'))
  ) {
    return true;
  }

  // Check for .xcodeproj or .xcworkspace directories
  try {
    const entries = fs.readdirSync(projectRoot);
    return entries.some(e => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'));
  } catch {
    return false;
  }
}

// =============================================================================
// PACKAGE.SWIFT PARSING
// =============================================================================

/**
 * Extract repo name from a GitHub/GitLab URL
 */
function extractRepoName(url: string): string {
  // https://github.com/owner/RepoName.git → RepoName
  // https://github.com/owner/RepoName → RepoName
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match ? match[1] : url;
}

/**
 * Parse Package.swift to extract dependencies and targets
 */
function parsePackageSwift(
  content: string,
  filePath: string,
  timestamp: number,
): { components: ArchitectureComponent[]; warnings: ScanWarning[] } {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];

  // Extract remote dependencies:
  // .package(url: "https://github.com/owner/repo", from: "1.0.0")
  // .package(url: "...", .upToNextMajor(from: "1.0.0"))
  // .package(url: "...", exact: "1.0.0")
  // .package(url: "...", branch: "main")
  const packagePatterns = [
    // .package(url: "...", from: "version")
    /\.package\(\s*(?:name:\s*"([^"]*)",\s*)?url:\s*"([^"]*)",\s*from:\s*"([^"]*)"\s*\)/g,
    // .package(url: "...", .upToNextMajor(from: "version"))
    /\.package\(\s*(?:name:\s*"([^"]*)",\s*)?url:\s*"([^"]*)",\s*\.(?:upToNextMajor|upToNextMinor)\(from:\s*"([^"]*)"\)\s*\)/g,
    // .package(url: "...", exact: "version")
    /\.package\(\s*(?:name:\s*"([^"]*)",\s*)?url:\s*"([^"]*)",\s*exact:\s*"([^"]*)"\s*\)/g,
    // .package(url: "...", branch: "name")
    /\.package\(\s*(?:name:\s*"([^"]*)",\s*)?url:\s*"([^"]*)",\s*branch:\s*"([^"]*)"\s*\)/g,
    // .package(url: "...", "version"..<"version") — range
    /\.package\(\s*(?:name:\s*"([^"]*)",\s*)?url:\s*"([^"]*)",\s*"([^"]*)"(?:\s*\.\.<?)\s*"[^"]*"\s*\)/g,
  ];

  for (const pattern of packagePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1] || extractRepoName(match[2]);
      const version = match[3];
      components.push(
        createComponentFromSwiftPackage(name, version, filePath, timestamp),
      );
    }
  }

  // Extract system library targets: .systemLibrary(name: "CSQLite", path: "CSQLite")
  const sysLibPattern = /\.systemLibrary\(\s*name:\s*"([^"]*)"/g;
  let sysMatch;
  while ((sysMatch = sysLibPattern.exec(content)) !== null) {
    components.push(
      createComponentFromSwiftPackage(sysMatch[1], undefined, filePath, timestamp),
    );
  }

  return { components, warnings };
}

// =============================================================================
// PODFILE PARSING
// =============================================================================

/**
 * Parse Podfile to extract CocoaPods dependencies
 */
function parsePodfile(
  content: string,
  filePath: string,
  timestamp: number,
): { components: ArchitectureComponent[]; warnings: ScanWarning[] } {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];

  // Match: pod 'PodName', '~> 1.0'
  //        pod 'PodName', :git => '...'
  //        pod 'PodName'
  const podPattern = /^\s*pod\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/gm;

  let match;
  while ((match = podPattern.exec(content)) !== null) {
    const name = match[1];
    const version = match[2]?.replace(/^[~>=<]+\s*/, '');
    components.push(
      createComponentFromSwiftPackage(name, version, filePath, timestamp),
    );
  }

  return { components, warnings };
}

// =============================================================================
// FRAMEWORK IMPORT DETECTION
// =============================================================================

/**
 * Scan .swift files for framework imports and match against known signatures
 */
async function detectFrameworkImports(
  projectRoot: string,
  timestamp: number,
  alreadyFound: Set<string>,
): Promise<ArchitectureComponent[]> {
  const components: ArchitectureComponent[] = [];

  const swiftFiles = await glob('**/*.swift', {
    cwd: projectRoot,
    ignore: [
      '.build/**',
      'DerivedData/**',
      '.swiftpm/**',
      'Pods/**',
      'Carthage/**',
      '*.playground/**',
    ],
  });

  const allImports = new Set<string>();

  for (const file of swiftFiles) {
    try {
      const content = await fs.promises.readFile(
        path.join(projectRoot, file),
        'utf-8',
      );
      // Match: import FrameworkName
      //        import struct FrameworkName.Type
      //        @testable import FrameworkName
      const importPattern = /^\s*(?:@testable\s+)?import\s+(?:struct\s+|class\s+|enum\s+|protocol\s+|func\s+)?(\w+)/gm;
      let match;
      while ((match = importPattern.exec(content)) !== null) {
        allImports.add(match[1]);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Match imports against framework signatures
  for (const importName of allImports) {
    if (alreadyFound.has(importName)) continue;

    const signature = SWIFT_FRAMEWORK_SIGNATURES.find(
      (s) => s.packageName === importName,
    );

    if (signature) {
      components.push({
        component_id: generateComponentId(signature.type, importName),
        name: importName,
        type: signature.type,
        role: {
          purpose: signature.purpose,
          layer: signature.layer,
          critical: signature.critical,
        },
        source: {
          detection_method: 'auto',
          config_files: [],
          confidence: 0.9,
        },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: ['swift', 'import', signature.type, signature.layer],
        timestamp,
        last_updated: timestamp,
      });
    }
  }

  return components;
}

// =============================================================================
// MAIN SCANNER
// =============================================================================

/**
 * Scan for Swift/iOS/Mac packages
 */
export async function scanSpmPackages(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // 1. Parse Package.swift
  const packageSwiftPath = path.join(projectRoot, 'Package.swift');
  if (fs.existsSync(packageSwiftPath)) {
    try {
      const content = await fs.promises.readFile(packageSwiftPath, 'utf-8');
      const result = parsePackageSwift(content, 'Package.swift', timestamp);
      components.push(...result.components);
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse Package.swift: ${error}`,
        file: 'Package.swift',
      });
    }
  }

  // 2. Parse Podfile
  const podfilePath = path.join(projectRoot, 'Podfile');
  if (fs.existsSync(podfilePath)) {
    try {
      const content = await fs.promises.readFile(podfilePath, 'utf-8');
      const result = parsePodfile(content, 'Podfile', timestamp);
      components.push(...result.components);
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push({
        type: 'parse_error',
        message: `Failed to parse Podfile: ${error}`,
        file: 'Podfile',
      });
    }
  }

  // 3. Detect framework imports from .swift source files
  const alreadyFound = new Set(components.map((c) => c.name));
  const frameworkComponents = await detectFrameworkImports(
    projectRoot,
    timestamp,
    alreadyFound,
  );
  components.push(...frameworkComponents);

  return { components, connections: [], warnings };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Create a component from a Swift package dependency
 */
function createComponentFromSwiftPackage(
  name: string,
  version: string | undefined,
  configFile: string,
  timestamp: number,
): ArchitectureComponent {
  const signature = SWIFT_FRAMEWORK_SIGNATURES.find(
    (s) => s.packageName.toLowerCase() === name.toLowerCase(),
  );

  const type: ComponentType = signature?.type || 'spm';
  const layer = signature?.layer || 'backend';
  const purpose = signature?.purpose || 'Swift package';
  const critical = signature?.critical ?? true;

  const cleanVersion = version?.replace(/^[~>=<^]+\s*/, '');

  return {
    component_id: generateComponentId(type, name),
    name,
    version: cleanVersion,
    type,
    role: {
      purpose,
      layer,
      critical,
    },
    source: {
      detection_method: 'auto',
      config_files: [configFile],
      confidence: 1.0,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['spm', type, layer],
    timestamp,
    last_updated: timestamp,
  };
}
