/**
 * Guard tests for `parseSwiftPackageTargets`.
 *
 * The defect these exist to prevent: the SPM target parser matched only each
 * target's `name:` and hardcoded `dependencies: []`, so every Swift package
 * scanned produced an EMPTY internal dependency graph. On a real repo that
 * left NavGator reporting 4 import edges across 77 Swift files.
 */
import { describe, it, expect } from 'vitest';
import { parseSwiftPackageTargets } from '../scanners/swift/code-scanner.js';

const AMBIENT_MANIFEST = `// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "RossLabsAmbientAgent",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AmbientContracts", targets: ["AmbientContracts"]),
        .executable(name: "ambientd", targets: ["ambientd"]),
    ],
    targets: [
        .target(name: "AmbientContracts"),
        .target(
            name: "AmbientCapabilities",
            dependencies: ["AmbientContracts"]
        ),
        .target(
            name: "AmbientCore",
            dependencies: ["AmbientContracts"],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedFramework("Security"),
            ]
        ),
        .executableTarget(
            name: "ambientd",
            dependencies: ["AmbientContracts", "AmbientCore"]
        ),
        .testTarget(
            name: "AmbientCoreTests",
            dependencies: ["AmbientContracts", "AmbientCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)`;

describe('parseSwiftPackageTargets', () => {
  const targets = parseSwiftPackageTargets(AMBIENT_MANIFEST);
  const byName = Object.fromEntries(targets.map((t) => [t.name, t]));

  it('finds every target and no product entries', () => {
    expect(targets.map((t) => t.name).sort()).toEqual([
      'AmbientCapabilities',
      'AmbientContracts',
      'AmbientCore',
      'AmbientCoreTests',
      'ambientd',
    ]);
  });

  it('resolves internal target dependencies instead of returning empty', () => {
    expect(byName['AmbientCore'].dependencies).toEqual(['AmbientContracts']);
    expect(byName['ambientd'].dependencies.sort()).toEqual(['AmbientContracts', 'AmbientCore']);
    expect(byName['AmbientCoreTests'].dependencies.sort()).toEqual([
      'AmbientContracts',
      'AmbientCore',
    ]);
  });

  it('leaves a dependency-free target empty', () => {
    expect(byName['AmbientContracts'].dependencies).toEqual([]);
  });

  it('does not mistake linkerSettings strings for dependencies', () => {
    expect(byName['AmbientCore'].dependencies).not.toContain('sqlite3');
    expect(byName['AmbientCore'].dependencies).not.toContain('Security');
  });

  it('classifies target kinds', () => {
    expect(byName['ambientd'].type).toBe('executable');
    expect(byName['AmbientCoreTests'].type).toBe('test');
    expect(byName['AmbientCore'].type).toBe('library');
  });

  it('handles .product and .target dependency spellings', () => {
    const manifest = `
    targets: [
        .target(
            name: "App",
            dependencies: [
                .product(name: "Algorithms", package: "swift-algorithms"),
                .target(name: "Core"),
                .byName(name: "Legacy"),
                "Plain",
            ]
        ),
    ]`;
    const [app] = parseSwiftPackageTargets(manifest);
    expect(app.dependencies.sort()).toEqual(['Algorithms', 'Core', 'Legacy', 'Plain']);
    expect(app.dependencies).not.toContain('swift-algorithms');
  });

  it('is not fooled by a bracket inside a string or comment', () => {
    const manifest = `
    targets: [
        .target(
            name: "Odd",
            // dependencies: ["NotReal"]
            dependencies: ["Real"],
            swiftSettings: [.define("A]B")]
        ),
    ]`;
    const [odd] = parseSwiftPackageTargets(manifest);
    expect(odd.name).toBe('Odd');
    expect(odd.dependencies).toEqual(['Real']);
  });
});
