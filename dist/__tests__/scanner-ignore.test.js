/**
 * Scanner ignore behavior for generated dependency/build trees.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scan } from '../scanner.js';
let tmp;
function writeFixture(relPath, content) {
    const fullPath = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
}
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-ignore-'));
});
afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});
describe('scanner ignore patterns', () => {
    it('does not treat generated build, dependency, or tool-state trees as app architecture', async () => {
        writeFixture('Package.swift', `
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "IgnoreFixture",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "IgnoreFixture", targets: ["IgnoreFixture"])],
  targets: [.executableTarget(name: "IgnoreFixture")]
)
`);
        writeFixture('Sources/IgnoreFixture/AppView.swift', `
import SwiftUI

struct AppView: View {
  var body: some View {
    Text("real app")
  }
}
`);
        writeFixture('build-local/SourcePackages/checkouts/SwiftTerm/DebugViewController.swift', `
import SwiftUI

struct GeneratedDependencyView: View {
  var body: some View {
    Text("generated dependency")
  }
}
`);
        writeFixture('SourcePackages/checkouts/SwiftTerm/VendoredDependencyView.swift', `
import SwiftUI

struct VendoredDependencyView: View {
  var body: some View {
    Text("resolved dependency")
  }
}
`);
        writeFixture('.rally/worktrees/peer/Sources/PeerWorktreeView.swift', `
import SwiftUI

struct PeerWorktreeView: View {
  var body: some View {
    Text("peer worktree")
  }
}
`);
        writeFixture('.claude/worktrees/peer/Sources/ClaudeWorktreeView.swift', `
import SwiftUI

struct ClaudeWorktreeView: View {
  var body: some View {
    Text("claude worktree")
  }
}
`);
        writeFixture('.build-loop/worktrees/peer/Sources/BuildLoopWorktreeView.swift', `
import SwiftUI

struct BuildLoopWorktreeView: View {
  var body: some View {
    Text("build loop worktree")
  }
}
`);
        writeFixture('.navgator/architecture/Sources/NavigatorOutputView.swift', `
import SwiftUI

struct NavigatorOutputView: View {
  var body: some View {
    Text("navgator output")
  }
}
`);
        writeFixture('build-local/SourcePackages/checkouts/SwiftTerm/Base.lproj/Main.storyboard', `
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB">
  <scenes>
    <scene sceneID="scene-1">
      <objects>
        <viewController id="vc-1" customClass="GeneratedStoryboardController"/>
      </objects>
    </scene>
  </scenes>
</document>
`);
        writeFixture('SourcePackages/checkouts/SwiftTerm/Base.lproj/Main.storyboard', `
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB">
  <scenes>
    <scene sceneID="scene-2">
      <objects>
        <viewController id="vc-2" customClass="VendoredStoryboardController"/>
      </objects>
    </scene>
  </scenes>
</document>
`);
        const result = await scan(tmp, { mode: 'full' });
        const componentNames = result.components.map((component) => component.name);
        const scannedFiles = result.connections
            .flatMap((connection) => [
            connection.from.location?.file,
            connection.code_reference?.file,
        ])
            .filter(Boolean);
        expect(componentNames).toContain('AppView');
        expect(componentNames).not.toContain('GeneratedDependencyView');
        expect(componentNames).not.toContain('VendoredDependencyView');
        expect(componentNames).not.toContain('PeerWorktreeView');
        expect(componentNames).not.toContain('ClaudeWorktreeView');
        expect(componentNames).not.toContain('BuildLoopWorktreeView');
        expect(componentNames).not.toContain('NavigatorOutputView');
        expect(componentNames).not.toContain('GeneratedStoryboardController');
        expect(componentNames).not.toContain('VendoredStoryboardController');
        expect(scannedFiles.some((file) => file?.includes('SourcePackages'))).toBe(false);
        expect(scannedFiles.some((file) => file?.includes('.rally'))).toBe(false);
        expect(scannedFiles.some((file) => file?.includes('.claude'))).toBe(false);
        expect(scannedFiles.some((file) => file?.includes('.build-loop'))).toBe(false);
        expect(scannedFiles.some((file) => file?.includes('.navgator'))).toBe(false);
        expect(result.stats.files_scanned).toBe(2);
    });
});
//# sourceMappingURL=scanner-ignore.test.js.map