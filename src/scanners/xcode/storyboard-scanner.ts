/**
 * Storyboard and XIB Scanner
 * Detects view controllers and segues from Interface Builder files
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// TYPES
// =============================================================================

interface ViewController {
  id: string;
  customClass?: string;
  storyboardIdentifier?: string;
  file: string;
  line: number;
}

interface Segue {
  id?: string;
  kind: string;
  destination: string;
  identifier?: string;
  source: string;
  file: string;
  line: number;
}

// =============================================================================
// MAIN SCANNER
// =============================================================================

/**
 * Scan all .storyboard and .xib files in the project
 */
export async function scanStoryboards(projectRoot: string): Promise<{
  components: ArchitectureComponent[];
  connections: ArchitectureConnection[];
}> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const timestamp = Date.now();

  // Find all storyboard and XIB files
  const storyboardFiles = await glob('**/*.{storyboard,xib}', {
    cwd: projectRoot,
    ignore: [
      '**/node_modules/**',
      '**/build/**',
      '**/DerivedData/**',
      '**/.build/**',
      '**/Pods/**',
      '**/Carthage/**',
    ],
  });

  // Track view controllers by ID (for segue resolution)
  const viewControllerMap = new Map<string, { vc: ViewController; componentId: string }>();

  // Pass 1: Extract view controllers
  for (const file of storyboardFiles) {
    const filePath = path.join(projectRoot, file);
    const content = await fs.promises.readFile(filePath, 'utf-8');

    const viewControllers = extractViewControllers(content, file);

    for (const vc of viewControllers) {
      const component = createViewControllerComponent(vc, timestamp);
      components.push(component);
      viewControllerMap.set(vc.id, { vc, componentId: component.component_id });
    }
  }

  // Pass 2: Extract segues and create connections
  for (const file of storyboardFiles) {
    const filePath = path.join(projectRoot, file);
    const content = await fs.promises.readFile(filePath, 'utf-8');

    const segues = extractSegues(content, file);

    for (const segue of segues) {
      const sourceVc = viewControllerMap.get(segue.source);
      const destVc = viewControllerMap.get(segue.destination);

      if (sourceVc && destVc) {
        const connection = createSegueConnection(
          sourceVc,
          destVc,
          segue,
          timestamp
        );
        connections.push(connection);
      }
    }
  }

  return { components, connections };
}

// =============================================================================
// VIEW CONTROLLER EXTRACTION
// =============================================================================

/**
 * Extract view controllers from storyboard/XIB XML
 */
function extractViewControllers(content: string, file: string): ViewController[] {
  const viewControllers: ViewController[] = [];

  // Match view controller elements
  // <viewController id="BYZ-38-t0r" customClass="ViewController" customModule="MyApp" ...>
  // <tableViewController id="abc-123" customClass="MyTableVC" ...>
  // <navigationController id="xyz-456" ...>
  // <tabBarController ...>
  // <pageViewController ...>
  // <collectionViewController ...>

  const vcPatterns = [
    /<(viewController|tableViewController|collectionViewController|navigationController|tabBarController|pageViewController|splitViewController)\s+([^>]+)>/g,
  ];

  for (const pattern of vcPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const vcType = match[1];
      const attributes = match[2];

      // Extract attributes
      const id = extractAttribute(attributes, 'id');
      const customClass = extractAttribute(attributes, 'customClass');
      const storyboardIdentifier = extractAttribute(attributes, 'storyboardIdentifier');

      if (id) {
        // Calculate approximate line number
        const line = content.substring(0, match.index).split('\n').length;

        viewControllers.push({
          id,
          customClass: customClass || undefined,
          storyboardIdentifier: storyboardIdentifier || undefined,
          file,
          line,
        });
      }
    }
  }

  return viewControllers;
}

/**
 * Extract an XML attribute value
 */
function extractAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`${name}="([^"]+)"`));
  return match ? match[1] : null;
}

// =============================================================================
// SEGUE EXTRACTION
// =============================================================================

/**
 * Extract segues from storyboard XML
 */
function extractSegues(content: string, file: string): Segue[] {
  const segues: Segue[] = [];

  // Find all view controller sections to map segues to their source
  const vcSectionPattern = /<(viewController|tableViewController|collectionViewController|navigationController|tabBarController|pageViewController|splitViewController)\s+([^>]+)>[\s\S]*?<\/\1>/g;

  let vcMatch;
  while ((vcMatch = vcSectionPattern.exec(content)) !== null) {
    const vcAttributes = vcMatch[2];
    const vcBody = vcMatch[0];
    const sourceId = extractAttribute(vcAttributes, 'id');

    if (!sourceId) continue;

    // Extract segues within this view controller
    // <segue destination="xyz-123" kind="show" identifier="showDetail" id="abc-456"/>
    // <segue destination="xyz-123" kind="presentation" modalPresentationStyle="fullScreen"/>
    const seguePattern = /<segue\s+([^>]+)\/>/g;

    let segueMatch;
    while ((segueMatch = seguePattern.exec(vcBody)) !== null) {
      const segueAttributes = segueMatch[1];

      const destination = extractAttribute(segueAttributes, 'destination');
      const kind = extractAttribute(segueAttributes, 'kind') || 'show';
      const identifier = extractAttribute(segueAttributes, 'identifier');
      const id = extractAttribute(segueAttributes, 'id');

      if (destination) {
        // Calculate approximate line number
        const line = content.substring(0, vcMatch.index + segueMatch.index).split('\n').length;

        segues.push({
          id: id || undefined,
          kind,
          destination,
          identifier: identifier || undefined,
          source: sourceId,
          file,
          line,
        });
      }
    }
  }

  return segues;
}

// =============================================================================
// COMPONENT CREATION
// =============================================================================

/**
 * Create a component for a view controller
 */
function createViewControllerComponent(
  vc: ViewController,
  timestamp: number
): ArchitectureComponent {
  const name = vc.customClass || vc.storyboardIdentifier || vc.id;
  const componentId = generateComponentId('component', `vc-${name}`);

  return {
    component_id: componentId,
    name,
    type: 'component',
    role: {
      purpose: `View controller${vc.customClass ? ` (${vc.customClass})` : ''}`,
      layer: 'frontend',
      critical: false,
    },
    source: {
      detection_method: 'auto',
      config_files: [vc.file],
      confidence: 1.0,
    },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['swift', 'storyboard', 'view-controller'],
    metadata: {
      storyboardId: vc.id,
      customClass: vc.customClass,
      storyboardIdentifier: vc.storyboardIdentifier,
      file: vc.file,
    },
    timestamp,
    last_updated: timestamp,
  };
}

// =============================================================================
// CONNECTION CREATION
// =============================================================================

/**
 * Create a connection for a segue
 */
function createSegueConnection(
  source: { vc: ViewController; componentId: string },
  dest: { vc: ViewController; componentId: string },
  segue: Segue,
  timestamp: number
): ArchitectureConnection {
  const connectionId = generateConnectionId('navigates-to');

  const segueKindLabel = segue.kind === 'show' ? 'shows' :
                        segue.kind === 'presentation' ? 'presents' :
                        segue.kind === 'push' ? 'pushes' :
                        segue.kind === 'modal' ? 'presents modally' :
                        'navigates to';

  const description = `${source.vc.customClass || source.vc.id} ${segueKindLabel} ${dest.vc.customClass || dest.vc.id}${segue.identifier ? ` (${segue.identifier})` : ''}`;

  return {
    connection_id: connectionId,
    from: {
      component_id: source.componentId,
      location: {
        file: segue.file,
        line: segue.line,
      },
    },
    to: {
      component_id: dest.componentId,
      location: {
        file: segue.file,
        line: segue.line,
      },
    },
    connection_type: 'navigates-to',
    code_reference: {
      file: segue.file,
      symbol: segue.identifier || segue.id || 'segue',
      symbol_type: 'variable',
      line_start: segue.line,
      code_snippet: `<segue kind="${segue.kind}" destination="${dest.vc.id}"${segue.identifier ? ` identifier="${segue.identifier}"` : ''}/>`,
    },
    description,
    detected_from: 'storyboard-scanner',
    confidence: 1.0,
    timestamp,
    last_verified: timestamp,
  };
}
