/**
 * Xcode target membership: file paths resolve through the group tree and
 * synchronized folders, every `target-contains` edge lands on a real file
 * node, and a launched (app/extension) target is an entry point without its
 * membership edges making every member file reachable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseXcodeProject, mapTargetToComponent, mapSourceMembership } from '../scanners/xcode/pbxproj-parser.js';
import { resolveFileEndpoints, scan, xcodeTargetMembers } from '../scanner.js';
import { detectEntryPoints } from '../entry-points.js';
import { getBuiltinRules } from '../rules.js';
import type { ArchitectureComponent, ArchitectureConnection } from '../types.js';
import { createConnection } from './helpers.js';

// App/Demo.xcodeproj: target `Demo` compiles ../Shared/Wire/Contract.swift via
// a Sources build phase, and everything under the synchronized folder `Sources`
// except Sources/Legacy/Old.swift (a membership exception for this target).
const PBXPROJ = `// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {

/* Begin PBXBuildFile section */
		BF01 /* Contract.swift in Sources */ = {isa = PBXBuildFile; fileRef = FR01 /* Contract.swift */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		FR01 /* Contract.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = Contract.swift; sourceTree = "<group>"; };
		FR02 /* Demo.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; path = Demo.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXFileSystemSynchronizedBuildFileExceptionSet section */
		EX01 /* Exceptions for "Sources" folder in "Demo" target */ = {
			isa = PBXFileSystemSynchronizedBuildFileExceptionSet;
			membershipExceptions = (
				Legacy/Old.swift,
			);
			target = TG01 /* Demo */;
		};
/* End PBXFileSystemSynchronizedBuildFileExceptionSet section */

/* Begin PBXFileSystemSynchronizedRootGroup section */
		SG01 /* Sources */ = {
			isa = PBXFileSystemSynchronizedRootGroup;
			exceptions = (
				EX01 /* Exceptions for "Sources" folder in "Demo" target */,
			);
			explicitFileTypes = {
			};
			path = Sources;
			sourceTree = "<group>";
		};
/* End PBXFileSystemSynchronizedRootGroup section */

/* Begin PBXGroup section */
		GR00 = {
			isa = PBXGroup;
			children = (
				SG01 /* Sources */,
				GR01 /* Wire */,
			);
			sourceTree = "<group>";
		};
		GR01 /* Wire */ = {
			isa = PBXGroup;
			children = (
				FR01 /* Contract.swift */,
			);
			name = Wire;
			path = ../Shared/Wire;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		TG01 /* Demo */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				PH01 /* Sources */,
			);
			fileSystemSynchronizedGroups = (
				SG01 /* Sources */,
			);
			name = Demo;
			productName = Demo;
			productReference = FR02 /* Demo.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXSourcesBuildPhase section */
		PH01 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			files = (
				BF01 /* Contract.swift in Sources */,
			);
		};
/* End PBXSourcesBuildPhase section */
	};
	rootObject = GR00;
}
`;

let tmp: string;

function write(rel: string, content: string): void {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function fileNode(file: string): ArchitectureComponent {
  return {
    component_id: `COMP_file_${file.replace(/[^a-z0-9]/gi, '_')}`,
    name: file.replace(/\.swift$/, ''),
    type: 'component',
    role: { purpose: `Source file at ${file}`, layer: 'backend', critical: false },
    source: { detection_method: 'auto', config_files: [file], confidence: 0.6 },
    connects_to: [],
    connected_from: [],
    status: 'active',
    tags: ['file-node'],
    metadata: { file, kind: 'source-file' },
    timestamp: 0,
    last_updated: 0,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-xcode-'));
  write('App/Demo.xcodeproj/project.pbxproj', PBXPROJ);
  write('App/Sources/DemoApp.swift', '@main struct DemoApp {}\n');
  write('App/Sources/Unused.swift', 'struct Unused {}\n');
  write('App/Sources/Legacy/Old.swift', 'struct Old {}\n');
  write('Shared/Wire/Contract.swift', 'struct Contract {}\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Xcode target membership', () => {
  it('resolves build-phase files through the group tree and reads synchronized folders', () => {
    const [target] = parseXcodeProject(path.join(tmp, 'App/Demo.xcodeproj/project.pbxproj')).targets;
    expect(target.name).toBe('Demo');
    expect(target.type).toBe('app');
    expect(target.sourceFiles).toEqual(['../Shared/Wire/Contract.swift']);
    expect(target.syncedFolders).toEqual([{ path: 'Sources', exclude: ['Legacy/Old.swift'] }]);
  });

  it('binds every target-contains edge to an existing file node', () => {
    const pbxprojPath = path.join(tmp, 'App/Demo.xcodeproj/project.pbxproj');
    const [target] = parseXcodeProject(pbxprojPath).targets;
    const files = ['App/Sources/DemoApp.swift', 'App/Sources/Unused.swift', 'App/Sources/Legacy/Old.swift', 'Shared/Wire/Contract.swift'];
    const components: ArchitectureComponent[] = files.map(fileNode);
    const targetComp = mapTargetToComponent(target, 0);
    components.push(targetComp);

    const members = xcodeTargetMembers(target, pbxprojPath, tmp, components);
    expect(members).toEqual(['App/Sources/DemoApp.swift', 'App/Sources/Unused.swift', 'Shared/Wire/Contract.swift']);

    const connections = mapSourceMembership({ ...target, sourceFiles: members }, targetComp.component_id, 0);
    resolveFileEndpoints(components, connections, tmp);
    const ids = new Set(components.map(c => c.component_id));
    expect(connections).toHaveLength(3);
    for (const conn of connections) expect(ids.has(conn.to.component_id)).toBe(true);
    // No new nodes were minted: each edge found the scanned file's node.
    expect(components).toHaveLength(files.length + 1);
  });

  it('roots an app target without making its member files reachable', () => {
    const target = { ...fileNode('App/Demo.xcodeproj/project.pbxproj'), component_id: 'COMP_target', name: 'Demo', tags: ['swift', 'xcode-target', 'app'] };
    const testTarget = { ...target, component_id: 'COMP_tests', name: 'DemoLib', tags: ['swift', 'xcode-target', 'framework'] };
    const main = { ...fileNode('App/Sources/DemoApp.swift'), tags: ['entrypoint'] };
    const used = fileNode('App/Sources/Used.swift');
    const unused = fileNode('App/Sources/Unused.swift');
    const components = [target, testTarget, main, used, unused];
    const edge = (from: string, to: string, type: ArchitectureConnection['connection_type']): ArchitectureConnection => ({
      ...createConnection(from, to),
      connection_type: type,
    });
    const connections = [
      edge(target.component_id, main.component_id, 'target-contains'),
      edge(target.component_id, used.component_id, 'target-contains'),
      edge(target.component_id, unused.component_id, 'target-contains'),
      edge(testTarget.component_id, unused.component_id, 'target-contains'),
      edge(main.component_id, used.component_id, 'references'),
    ];

    const roots = detectEntryPoints(components, { skipManifests: true }).ids;
    expect(roots.has(target.component_id)).toBe(true);
    expect(roots.has(testTarget.component_id)).toBe(false);

    const dead = getBuiltinRules(tmp)
      .find(r => r.id === 'transitively-dead')!
      .check(components, connections)
      .map(v => v.component)
      .sort();
    // The app target is live; the unreferenced file is still reported even
    // though the app target compiles it. The framework target is not launched.
    expect(dead).toEqual(['App/Sources/Unused', 'DemoLib']);
  });

  it('full scan: no dangling membership edges, and the Xcode node is connected', async () => {
    write('Package.swift', '// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "Demo")\n');
    const result = await scan(tmp, { mode: 'full' });
    const ids = new Set(result.components.map(c => c.component_id));
    const membership = result.connections.filter(c => c.connection_type === 'target-contains');
    expect(membership.length).toBeGreaterThan(0);
    for (const conn of membership) {
      expect(ids.has(conn.from.component_id)).toBe(true);
      expect(ids.has(conn.to.component_id)).toBe(true);
    }
    const xcode = result.components.find(c => c.type === 'infra' && c.name === 'Xcode');
    expect(xcode).toBeDefined();
    expect(membership.some(c => c.from.component_id === xcode!.component_id)).toBe(true);
  });
});
