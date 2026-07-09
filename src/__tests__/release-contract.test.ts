import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NAVGATOR_LICENSE, NAVGATOR_PACKAGE_NAME, NAVGATOR_VERSION } from '../version.js';

const root = path.resolve(__dirname, '../..');

function json(relativePath: string) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function text(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('release contract', () => {
  it('uses package.json as the runtime identity source', () => {
    const packageJson = json('package.json');
    const packageLock = json('package-lock.json');
    const claudeManifest = json('.claude-plugin/plugin.json');
    const claudeMarketplace = json('.claude-plugin/marketplace.json');
    const codexManifest = json('.codex-plugin/plugin.json');
    const webPackage = json('web/package.json');
    const claudeEntry = claudeMarketplace.plugins.find((plugin: { name?: string }) => plugin.name === 'navgator');

    expect(NAVGATOR_PACKAGE_NAME).toBe('@tyroneross/navgator');
    expect(NAVGATOR_VERSION).toBe(packageJson.version);
    expect(NAVGATOR_LICENSE).toBe(packageJson.license);
    expect(packageJson.engines.node).toBe('>=20.11.0');
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
    expect(packageLock.packages[''].engines.node).toBe(packageJson.engines.node);
    expect(webPackage.dependencies.next).toBe('16.2.10');
    expect(webPackage.overrides.postcss).toBe('$postcss');
    for (const manifest of [claudeManifest, claudeEntry, codexManifest]) {
      expect(manifest).toMatchObject({
        name: 'navgator',
        version: packageJson.version,
        license: packageJson.license,
      });
    }
  });

  it('packages every intended host surface and excludes compiled tests by construction', () => {
    const packageJson = json('package.json');
    const tsconfig = json('tsconfig.json');

    expect(packageJson.files).toEqual(expect.arrayContaining([
      'dist',
      'commands',
      'agents',
      'skills',
      '.claude-plugin',
      '.codex-plugin',
      '.mcp.json',
      'scripts/promote-lessons.py',
      'web/server.cjs',
      'web/runtime',
    ]));
    expect(tsconfig.exclude).toContain('src/__tests__/**');
    expect(json('hooks/hooks.json')).toEqual({ hooks: {} });
  });

  it('keeps Claude and Codex process resolution host-specific', () => {
    const claudeMcp = json('.mcp.json').mcpServers.navgator;
    const codexManifest = json('.codex-plugin/plugin.json');
    const codexMcp = json('.codex-plugin/mcp.json').mcpServers.navgator;

    expect(claudeMcp.args[0]).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(codexManifest.mcpServers).toBe('./.codex-plugin/mcp.json');
    expect(codexMcp).toMatchObject({
      command: 'node',
      args: ['dist/mcp/server.js'],
      cwd: '.',
    });
    expect(JSON.stringify(codexMcp)).not.toContain('CLAUDE_PLUGIN_ROOT');
  });

  it('launches the packaged dashboard on loopback', () => {
    const misc = text('src/cli/commands/misc.ts');

    expect(misc).toContain("path.join(packageRoot, 'web', 'server.cjs')");
    expect(misc).toContain("NODE_ENV: 'production'");
    expect(misc).toContain("HOSTNAME: '127.0.0.1'");
    expect(misc).not.toContain("'web', '.next', 'standalone'");
    expect(misc).not.toContain("HOSTNAME: '0.0.0.0'");
  });

  it('does not claim a raw Claude symlink is a registered plugin', () => {
    const misc = text('src/cli/commands/misc.ts');
    const readme = text('README.md');
    const installer = text('scripts/install-plugin.sh');

    expect(misc).not.toContain("path.join(claudeDir, 'plugins')");
    expect(misc).not.toContain('fs.symlinkSync(packageRoot');
    expect(readme).toContain('bash "$NAVGATOR_PACKAGE/scripts/install-plugin.sh" --global');
    expect(readme).toContain('plugin registry');
    expect(installer).toContain('navgator@rosslabs-ai-toolkit');
    expect(installer).toContain('claude plugin disable $legacy_id --scope $legacy_scope');
  });

  it('runs the full suite and packed verifier in CI and publish workflows', () => {
    const packageJson = json('package.json');
    const ci = text('.github/workflows/ci.yml');
    const publish = text('.github/workflows/publish.yml');

    expect(packageJson.scripts['test:release']).toBe('npm test');
    expect(packageJson.scripts.lint).toBeUndefined();
    expect(packageJson.scripts.typecheck).toContain('tsc --noEmit');
    expect(packageJson.scripts.typecheck).toContain('tsc -p tsconfig.test.json');
    expect(packageJson.scripts['verify:release']).toBe('node scripts/verify-release.mjs');
    for (const workflow of [ci, publish]) {
      expect(workflow).toContain('run: npm test');
      expect(workflow).toContain('run: npm run typecheck');
      expect(workflow).toContain('run: npm run build');
      expect(workflow).toContain('run: npm run verify:release');
      expect(workflow).toContain('@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}');
      expect(workflow).toContain('@openai/codex@${CODEX_CLI_VERSION}');
      expect(workflow).toContain("REQUIRE_CLAUDE_VALIDATION: '1'");
      expect(workflow).toContain("REQUIRE_CODEX_VALIDATION: '1'");
      expect(workflow).toContain('npm audit --omit=dev --audit-level=moderate');
      expect(workflow).toContain('npm --prefix web audit --omit=dev --audit-level=moderate');
      expect(workflow).not.toContain('scanner-incremental.test.ts');
      expect(workflow).not.toMatch(/uses:\s+actions\/[\w-]+@v\d/);
    }
    expect(ci).toContain("node-version: ['20.11.0', '22']");
    expect(publish).toContain('Verify tag matches package version');
    expect(publish).toContain('EXPECTED_TAG="v${PACKAGE_VERSION}"');
    expect(publish).toContain("node-version: ${{ env.PUBLISH_NODE_VERSION }}");
    expect(publish).toContain('npm pack --json --ignore-scripts');
    expect(publish).toContain('NAVGATOR_RELEASE_TARBALL: ${{ steps.artifact.outputs.file }}');
    expect(publish).toContain('actions/upload-artifact@');
    expect(publish).toContain('actions/download-artifact@');
    expect(publish).toContain('sha256sum -c *.sha256');
    expect(publish).toContain('needs: build');
    expect(publish.match(/npm publish .*--ignore-scripts/g)).toHaveLength(2);
    expect(publish).not.toContain('BUILD_NODE_VERSION');
  });

  it('keeps Codex installation messaging truthful and runtime-backed', () => {
    const claudeInstaller = text('scripts/install-plugin.sh');
    const installer = text('scripts/install-codex-plugin.sh');
    const verifier = text('scripts/verify-release.mjs');

    for (const hostInstaller of [claudeInstaller, installer]) {
      expect(hostInstaller).toContain('Node.js >=20.11.0 is required');
      expect(hostInstaller).toContain('major === 20 && minor >= 11');
      expect(hostInstaller).toContain('Refusing symlinked destination component');
    }
    expect(installer).toContain('npm install');
    expect(installer).toContain('navgator-runtime/node_modules/@tyroneross/navgator');
    expect(installer).toContain("path.join(packageDir, 'dist', 'mcp', 'server.js')");
    expect(installer).toContain('plugins/cache/navgator/navgator/$EXPECTED_VERSION');
    expect(installer).toContain('--prefix "$PACKAGE_DIR"');
    expect(installer).toContain("fs.openSync(candidate, 'wx', 0o600)");
    expect(installer).toContain('delete server.cwd');
    expect(installer).toContain('Registration does not install or enable the Codex plugin.');
    expect(installer).toContain('Start a new task');
    expect(verifier).toContain('NAVGATOR_RELEASE_TARBALL');
    expect(verifier).toContain('installed user cache scans after source removal');
    expect(verifier).toContain('leaves victim content unchanged');
  });
});
