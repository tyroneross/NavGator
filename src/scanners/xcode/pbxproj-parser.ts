/**
 * Xcode .pbxproj Parser
 * Parses ASCII plist format used by Xcode project files
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface XcodeTarget {
  name: string;
  type: 'app' | 'extension' | 'test' | 'framework' | 'widget' | 'other';
  bundleId?: string;
  productName?: string;
  sourceFiles: string[];   // relative paths
  frameworks: string[];    // linked framework names
  deploymentTargets: Record<string, string>; // { iOS: "17.0" }
}

export interface XcodeProjectData {
  targets: XcodeTarget[];
  buildConfigurations: string[];
  hasSwiftPackages: boolean;
}

// =============================================================================
// PRODUCT TYPE MAPPING
// =============================================================================

const PRODUCT_TYPE_MAP: Record<string, XcodeTarget['type']> = {
  'com.apple.product-type.application': 'app',
  'com.apple.product-type.app-extension': 'extension',
  'com.apple.product-type.application.watchapp': 'app',
  'com.apple.product-type.application.watchapp2': 'app',
  'com.apple.product-type.watchkit-extension': 'extension',
  'com.apple.product-type.watchkit2-extension': 'extension',
  'com.apple.product-type.app-clip': 'app',
  'com.apple.product-type.extensionkit-extension': 'extension',
  'com.apple.product-type.framework': 'framework',
  'com.apple.product-type.bundle.unit-test': 'test',
  'com.apple.product-type.bundle.ui-testing': 'test',
  'com.apple.product-type.library.static': 'framework',
  'com.apple.product-type.library.dynamic': 'framework',
  'com.apple.product-type.tool': 'other',
};

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse an Xcode .pbxproj file
 */
export function parseXcodeProject(pbxprojPath: string): XcodeProjectData {
  const content = fs.readFileSync(pbxprojPath, 'utf-8');

  // Extract all PBXNativeTarget sections
  const targets = extractTargets(content);

  // Extract build configurations
  const buildConfigurations = extractBuildConfigurations(content);

  // Check for Swift Package Manager integration
  const hasSwiftPackages = /XCRemoteSwiftPackageReference|XCSwiftPackageProductDependency/.test(content);

  // Build file reference map (ID → file path)
  const fileRefMap = buildFileReferenceMap(content);

  // Build build phase map (ID → file refs)
  const buildPhaseMap = buildBuildPhaseMap(content);

  // Populate source files and frameworks for each target
  for (const target of targets) {
    populateTargetDetails(target, content, fileRefMap, buildPhaseMap);
  }

  return {
    targets,
    buildConfigurations,
    hasSwiftPackages,
  };
}

// =============================================================================
// TARGET EXTRACTION
// =============================================================================

/**
 * Extract all PBXNativeTarget sections
 */
function extractTargets(content: string): XcodeTarget[] {
  const targets: XcodeTarget[] = [];

  // Match PBXNativeTarget sections
  // Format: 1A2B3C4D /* TargetName */ = { ... }
  const targetPattern = /(\w+)\s*\/\*\s*([^*]+?)\s*\*\/\s*=\s*\{[^}]*?isa\s*=\s*PBXNativeTarget;([^}]+?productType\s*=\s*"?([^";]+)"?[^}]*?)\}/gs;

  let match;
  while ((match = targetPattern.exec(content)) !== null) {
    const targetId = match[1];
    const targetName = match[2].trim();
    const targetBody = match[3];
    const productType = match[4];

    const type = PRODUCT_TYPE_MAP[productType] || 'other';

    targets.push({
      name: targetName,
      type,
      bundleId: undefined,
      productName: undefined,
      sourceFiles: [],
      frameworks: [],
      deploymentTargets: {},
    });
  }

  return targets;
}

// =============================================================================
// BUILD CONFIGURATION EXTRACTION
// =============================================================================

/**
 * Extract build configuration names
 */
function extractBuildConfigurations(content: string): string[] {
  const configs = new Set<string>();

  // Match XCBuildConfiguration sections
  const configPattern = /\/\*\s*([^*]+?)\s*\*\/\s*=\s*\{[^}]*?isa\s*=\s*XCBuildConfiguration;/g;

  let match;
  while ((match = configPattern.exec(content)) !== null) {
    const configName = match[1].trim();
    configs.add(configName);
  }

  return Array.from(configs);
}

// =============================================================================
// FILE REFERENCE MAP
// =============================================================================

/**
 * Build a map of file reference IDs to file paths
 */
function buildFileReferenceMap(content: string): Map<string, string> {
  const fileRefMap = new Map<string, string>();

  // Match PBXFileReference sections
  // Format: 1A2B3C4D /* filename */ = { isa = PBXFileReference; ... path = "filename"; ... }
  const fileRefPattern = /(\w+)\s*\/\*\s*([^*]+?)\s*\*\/\s*=\s*\{[^}]*?isa\s*=\s*PBXFileReference;([^}]+?)\}/gs;

  let match;
  while ((match = fileRefPattern.exec(content)) !== null) {
    const fileId = match[1];
    const fileName = match[2].trim();
    const body = match[3];

    // Extract path if available
    const pathMatch = body.match(/path\s*=\s*"?([^";]+)"?;/);
    const filePath = pathMatch ? pathMatch[1] : fileName;

    fileRefMap.set(fileId, filePath);
  }

  return fileRefMap;
}

// =============================================================================
// BUILD PHASE MAP
// =============================================================================

/**
 * Build a map of build phase IDs to file reference IDs
 */
function buildBuildPhaseMap(content: string): Map<string, { type: string; files: string[] }> {
  const buildPhaseMap = new Map<string, { type: string; files: string[] }>();

  // Match PBXSourcesBuildPhase and PBXFrameworksBuildPhase sections
  const buildPhasePattern = /(\w+)\s*\/\*\s*([^*]*?)\s*\*\/\s*=\s*\{[^}]*?isa\s*=\s*(PBXSourcesBuildPhase|PBXFrameworksBuildPhase);([^}]+?)\}/gs;

  let match;
  while ((match = buildPhasePattern.exec(content)) !== null) {
    const phaseId = match[1];
    const phaseType = match[3];
    const body = match[4];

    // Extract files array
    const filesMatch = body.match(/files\s*=\s*\(([^)]+)\)/s);
    const fileIds: string[] = [];

    if (filesMatch) {
      const filesContent = filesMatch[1];
      // Extract file reference IDs
      const fileRefPattern = /(\w+)\s*\/\*[^*]*?\*\//g;
      let fileMatch;
      while ((fileMatch = fileRefPattern.exec(filesContent)) !== null) {
        fileIds.push(fileMatch[1]);
      }
    }

    buildPhaseMap.set(phaseId, {
      type: phaseType,
      files: fileIds,
    });
  }

  // Build PBXBuildFile map (build file ID → file reference ID)
  const buildFileMap = new Map<string, string>();
  const buildFilePattern = /(\w+)\s*\/\*[^*]*?\*\/\s*=\s*\{[^}]*?isa\s*=\s*PBXBuildFile;[^}]*?fileRef\s*=\s*(\w+)/gs;

  let buildMatch;
  while ((buildMatch = buildFilePattern.exec(content)) !== null) {
    const buildFileId = buildMatch[1];
    const fileRefId = buildMatch[2];
    buildFileMap.set(buildFileId, fileRefId);
  }

  // Resolve build file IDs to file reference IDs
  for (const [phaseId, phase] of buildPhaseMap) {
    phase.files = phase.files.map(id => buildFileMap.get(id) || id);
  }

  return buildPhaseMap;
}

// =============================================================================
// TARGET DETAILS POPULATION
// =============================================================================

/**
 * Populate source files, frameworks, and deployment targets for a target
 */
function populateTargetDetails(
  target: XcodeTarget,
  content: string,
  fileRefMap: Map<string, string>,
  buildPhaseMap: Map<string, { type: string; files: string[] }>
): void {
  // Find the target's ID by name
  const targetPattern = new RegExp(
    `(\\w+)\\s*\\/\\*\\s*${escapeRegex(target.name)}\\s*\\*\\/\\s*=\\s*\\{[^}]*?isa\\s*=\\s*PBXNativeTarget;([^}]+?)\\}`,
    's'
  );

  const match = targetPattern.exec(content);
  if (!match) return;

  const targetId = match[1];
  const targetBody = match[2];

  // Extract build configuration list ID
  const configListMatch = targetBody.match(/buildConfigurationList\s*=\s*(\w+)/);
  if (configListMatch) {
    const configListId = configListMatch[1];

    // Extract deployment targets from build configurations
    const deploymentTargets = extractDeploymentTargets(content, configListId);
    target.deploymentTargets = deploymentTargets;

    // Extract bundle ID
    const bundleId = extractBundleId(content, configListId);
    if (bundleId) target.bundleId = bundleId;
  }

  // Extract product name
  const productNameMatch = targetBody.match(/productName\s*=\s*"?([^";]+)"?;/);
  if (productNameMatch) {
    target.productName = productNameMatch[1];
  }

  // Extract build phases
  const buildPhasesMatch = targetBody.match(/buildPhases\s*=\s*\(([^)]+)\)/s);
  if (buildPhasesMatch) {
    const phasesContent = buildPhasesMatch[1];
    const phaseIdPattern = /(\w+)\s*\/\*/g;

    let phaseMatch;
    while ((phaseMatch = phaseIdPattern.exec(phasesContent)) !== null) {
      const phaseId = phaseMatch[1];
      const phase = buildPhaseMap.get(phaseId);

      if (phase) {
        if (phase.type === 'PBXSourcesBuildPhase') {
          // Add source files
          for (const fileRefId of phase.files) {
            const filePath = fileRefMap.get(fileRefId);
            if (filePath && (filePath.endsWith('.swift') || filePath.endsWith('.m') || filePath.endsWith('.mm'))) {
              target.sourceFiles.push(filePath);
            }
          }
        } else if (phase.type === 'PBXFrameworksBuildPhase') {
          // Add frameworks
          for (const fileRefId of phase.files) {
            const filePath = fileRefMap.get(fileRefId);
            if (filePath) {
              const frameworkName = extractFrameworkName(filePath);
              if (frameworkName) {
                target.frameworks.push(frameworkName);
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Extract deployment targets from build configuration list
 */
function extractDeploymentTargets(content: string, configListId: string): Record<string, string> {
  const deploymentTargets: Record<string, string> = {};

  // Find configuration list
  const configListPattern = new RegExp(
    `${configListId}\\s*\\/\\*[^*]*?\\*\\/\\s*=\\s*\\{[^}]*?buildConfigurations\\s*=\\s*\\(([^)]+)\\)`,
    's'
  );

  const match = configListPattern.exec(content);
  if (!match) return deploymentTargets;

  const configurationsContent = match[1];
  const configIdPattern = /(\w+)\s*\/\*/g;

  let configMatch;
  while ((configMatch = configIdPattern.exec(configurationsContent)) !== null) {
    const configId = configMatch[1];

    // Extract build settings from this configuration
    const configPattern = new RegExp(
      `${configId}\\s*\\/\\*[^*]*?\\*\\/\\s*=\\s*\\{[^}]*?buildSettings\\s*=\\s*\\{([^}]+)\\}`,
      's'
    );

    const configBodyMatch = configPattern.exec(content);
    if (!configBodyMatch) continue;

    const buildSettings = configBodyMatch[1];

    // Extract deployment targets
    const platforms = ['IPHONEOS_DEPLOYMENT_TARGET', 'MACOSX_DEPLOYMENT_TARGET', 'WATCHOS_DEPLOYMENT_TARGET', 'TVOS_DEPLOYMENT_TARGET'];

    for (const platform of platforms) {
      const targetMatch = buildSettings.match(new RegExp(`${platform}\\s*=\\s*"?([^";]+)"?;`));
      if (targetMatch) {
        const platformName = platform.replace('_DEPLOYMENT_TARGET', '').toLowerCase().replace('iphoneos', 'iOS').replace('macosx', 'macOS').replace('watchos', 'watchOS').replace('tvos', 'tvOS');
        deploymentTargets[platformName] = targetMatch[1];
      }
    }

    // Only need to check one configuration (usually they're the same)
    break;
  }

  return deploymentTargets;
}

/**
 * Extract bundle identifier from build configuration list
 */
function extractBundleId(content: string, configListId: string): string | undefined {
  // Find configuration list
  const configListPattern = new RegExp(
    `${configListId}\\s*\\/\\*[^*]*?\\*\\/\\s*=\\s*\\{[^}]*?buildConfigurations\\s*=\\s*\\(([^)]+)\\)`,
    's'
  );

  const match = configListPattern.exec(content);
  if (!match) return undefined;

  const configurationsContent = match[1];
  const configIdPattern = /(\w+)\s*\/\*/g;

  let configMatch;
  while ((configMatch = configIdPattern.exec(configurationsContent)) !== null) {
    const configId = configMatch[1];

    // Extract build settings from this configuration
    const configPattern = new RegExp(
      `${configId}\\s*\\/\\*[^*]*?\\*\\/\\s*=\\s*\\{[^}]*?buildSettings\\s*=\\s*\\{([^}]+)\\}`,
      's'
    );

    const configBodyMatch = configPattern.exec(content);
    if (!configBodyMatch) continue;

    const buildSettings = configBodyMatch[1];

    // Extract PRODUCT_BUNDLE_IDENTIFIER
    const bundleIdMatch = buildSettings.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";]+)"?;/);
    if (bundleIdMatch) {
      return bundleIdMatch[1].replace(/\$\(PRODUCT_NAME:[a-z]+\)/g, '');
    }
  }

  return undefined;
}

/**
 * Extract framework name from file path
 */
function extractFrameworkName(filePath: string): string | undefined {
  // Extract framework name from paths like:
  // - "System/Library/Frameworks/UIKit.framework"
  // - "UIKit.framework"
  // - "libsqlite3.tbd"

  const frameworkMatch = filePath.match(/([^/]+)\.framework$/);
  if (frameworkMatch) return frameworkMatch[1];

  const tbdMatch = filePath.match(/lib([^/]+)\.tbd$/);
  if (tbdMatch) return tbdMatch[1];

  return undefined;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// COMPONENT MAPPING
// =============================================================================

/**
 * Map an Xcode target to a NavGator component
 */
export function mapTargetToComponent(target: XcodeTarget, timestamp: number): ArchitectureComponent {
  const componentId = generateComponentId('component', `xcode-${target.name}`);

  const layer = target.type === 'app' ? 'frontend' :
                target.type === 'extension' ? 'frontend' :
                target.type === 'test' ? 'backend' : 'backend';

  const purpose = `Xcode ${target.type} target${target.bundleId ? ` (${target.bundleId})` : ''}`;

  return {
    component_id: componentId,
    name: target.name,
    type: 'component',
    role: {
      purpose,
      layer,
      critical: target.type === 'app',
    },
    source: {
      detection_method: 'auto',
      config_files: ['project.pbxproj'],
      confidence: 1.0,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['swift', 'xcode-target', target.type],
    metadata: {
      targetType: target.type,
      bundleId: target.bundleId,
      productName: target.productName,
      deploymentTargets: target.deploymentTargets,
      frameworks: target.frameworks,
      sourceFileCount: target.sourceFiles.length,
    },
    timestamp,
    last_updated: timestamp,
  };
}

// =============================================================================
// CONNECTION MAPPING
// =============================================================================

/**
 * Map source file membership to connections
 */
export function mapSourceMembership(
  target: XcodeTarget,
  targetCompId: string,
  timestamp: number
): ArchitectureConnection[] {
  const connections: ArchitectureConnection[] = [];

  // Create connections for each source file
  for (const sourceFile of target.sourceFiles) {
    const fileComponentId = generateComponentId('component', `file-${sourceFile}`);

    connections.push({
      connection_id: generateConnectionId('target-contains'),
      from: {
        component_id: targetCompId,
        location: {
          file: 'project.pbxproj',
          line: 1,
        },
      },
      to: {
        component_id: fileComponentId,
        location: {
          file: sourceFile,
          line: 1,
        },
      },
      connection_type: 'target-contains',
      code_reference: {
        file: 'project.pbxproj',
        symbol: target.name,
        symbol_type: 'class',
        line_start: 1,
      },
      description: `Target ${target.name} contains ${sourceFile}`,
      detected_from: 'pbxproj-parser',
      confidence: 1.0,
      timestamp,
      last_verified: timestamp,
    });
  }

  return connections;
}
