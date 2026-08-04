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
    expect(packageJson.engines.node).toBe('>=20.19.0');
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
    expect(packageLock.packages[''].engines.node).toBe(packageJson.engines.node);
    expect(webPackage.dependencies.next).toBe('16.2.12');
    expect(webPackage.overrides.postcss).toBe('$postcss');
    for (const manifest of [claudeManifest, claudeEntry, codexManifest]) {
      expect(manifest).toMatchObject({
        name: 'navgator',
        license: packageJson.license,
      });
      if (manifest.version !== undefined) {
        expect(manifest.version).toBe(packageJson.version);
      }
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
      'mcp-optin',
      'scripts/promote-lessons.py',
      'web/server.cjs',
      'web/runtime',
    ]));
    // MCP ships as an opt-in template tree, never as an auto-loaded root config.
    expect(packageJson.files).not.toContain('.mcp.json');
    expect(tsconfig.exclude).toContain('src/__tests__/**');
    expect(json('hooks/hooks.json')).toEqual({ hooks: {} });
  });

  it('keeps Claude and Codex process resolution host-specific', () => {
    // MCP is opt-in: neither host may auto-load a config from the shipped tree.
    // Claude reads a root `.mcp.json`; Codex reads the path named by its
    // manifest's `mcpServers` key. Both auto-load surfaces must be absent.
    expect(fs.existsSync(path.join(root, '.mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.codex-plugin', 'mcp.json'))).toBe(false);
    expect(json('.codex-plugin/plugin.json').mcpServers).toBeUndefined();

    // Host-specific process resolution is still the property under test; only
    // the file locations moved. Claude resolves through the plugin root it
    // exports; Codex resolves relative to the package it copied into its cache.
    const claudeMcp = json('mcp-optin/claude.mcp.json').mcpServers.navgator;
    const codexMcp = json('mcp-optin/codex.mcp.json').mcpServers.navgator;

    expect(claudeMcp.args[0]).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(codexMcp).toMatchObject({
      command: 'node',
      args: ['dist/mcp/server.js'],
      cwd: '.',
    });
    expect(JSON.stringify(codexMcp)).not.toContain('CLAUDE_PLUGIN_ROOT');
  });

  it('makes MCP opt-in on both installers and probes dependencies through the CLI', () => {
    const claudeInstaller = text('scripts/install-plugin.sh');
    const codexInstaller = text('scripts/install-codex-plugin.sh');

    for (const installer of [claudeInstaller, codexInstaller]) {
      expect(installer).toContain('WITH_MCP="false"');
      expect(installer).toContain('--with-mcp)');
      expect(installer).toContain(
        'MCP is off by default. Re-run with --with-mcp only if your client cannot run a shell.',
      );
    }
    expect(claudeInstaller).toContain('mcp-optin/claude.mcp.json');
    expect(codexInstaller).toContain('mcp-optin/codex.mcp.json');

    // The dependency-completeness probe must run on the surface that ships by
    // default. It used to force-load the tree through dist/mcp/server.js; the
    // CLI entrypoint imports every command module, so it proves the same thing
    // on the surface every default install actually gets.
    expect(claudeInstaller).toContain('node "$INSTALL_PATH/dist/cli/index.js" --version');
    expect(claudeInstaller).toContain('Installed NavGator CLI failed its dependency-complete startup check.');
    // The MCP startup probe survives, but only behind the opt-in flag.
    expect(claudeInstaller).toMatch(
      /if \[ "\$WITH_MCP" = "true" \]; then\s*\n\s*if ! node "\$INSTALL_PATH\/dist\/mcp\/server\.js"/,
    );
  });

  it('documents the CLI-first agent interface policy on every shipped host doc', () => {
    const heading = '## Agent interface policy: CLI first, HTTP second, MCP last resort';

    for (const doc of ['README.md', 'CLAUDE.md', 'AGENTS.md']) {
      expect(text(doc)).toContain(heading);
    }
    expect(fs.existsSync(path.join(root, 'mcp-optin', 'README.md'))).toBe(true);
  });

  it('ships no agent surface that instructs an MCP tool call', () => {
    // Gate shape, validated against the real tree before landing:
    //  (a) MCP_CALL     — the word MCP within 40 same-clause characters of a
    //                     backticked NavGator tool name. `.` and `|` are
    //                     excluded from the gap so a sentence boundary or a
    //                     table cell wall breaks the association; that is what
    //                     keeps explanatory prose ("Every MCP tool has a direct
    //                     CLI replacement. `review` and `explore` are new")
    //                     from reading as a call instruction.
    //  (b) MCP_ROUTING  — a decision-tree table that routes user intent to an
    //                     MCP tool column ("| User Intent | MCP Tool |").
    // Deliberately NOT matched: "MCP is off by default", "no MCP server is
    // registered", "Pass `--with-mcp`", "aren't MCP tools", and the
    // "| MCP tool | CLI replacement |" migration table. All 18 such control
    // lines were checked clean; all 7 known invocation shapes were caught.
    const tools = [
      'arch_diff', 'arch-diff', 'connections', 'diagram', 'explore', 'impact',
      'portfolio', 'review', 'rules', 'scan', 'status', 'summary', 'trace',
    ].join('|');
    const MCP_CALL = new RegExp(
      `\\bMCP\\b[^\\n.|]{0,40}\`(?:navgator )?(?:${tools})\``
      + `|\`(?:navgator )?(?:${tools})\`[^\\n.|]{0,40}\\bMCP\\b`,
      'i',
    );
    const MCP_ROUTING = /\|[^\n|]*\b(?:intent|user|task|goal|request)\b[^\n|]*\|\s*MCP tools?\s*\|/i;

    const surfaces: string[] = [];
    for (const dir of ['commands', 'agents']) {
      for (const entry of fs.readdirSync(path.join(root, dir))) {
        if (entry.endsWith('.md')) surfaces.push(path.join(dir, entry));
      }
    }
    for (const entry of fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skill = path.join('skills', entry.name, 'SKILL.md');
      if (fs.existsSync(path.join(root, skill))) surfaces.push(skill);
    }
    expect(surfaces.length).toBeGreaterThanOrEqual(23);

    const offenders: string[] = [];
    for (const surface of surfaces) {
      for (const [index, line] of text(surface).split('\n').entries()) {
        if (MCP_CALL.test(line) || MCP_ROUTING.test(line)) {
          offenders.push(`${surface}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('launches the packaged dashboard on loopback', () => {
    const misc = text('src/cli/commands/misc.ts');
    const runtimeBuilder = text('scripts/prepare-web-runtime.mjs');

    expect(misc).toContain("path.join(packageRoot, 'web', 'server.cjs')");
    expect(misc).toContain("NODE_ENV: 'production'");
    expect(misc).toContain("HOSTNAME: '127.0.0.1'");
    expect(misc).not.toContain("'web', '.next', 'standalone'");
    expect(misc).not.toContain("HOSTNAME: '0.0.0.0'");
    expect(runtimeBuilder).toContain("process.env.HOSTNAME = '127.0.0.1'");
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
    expect(ci).toContain("node-version: ['20.19.0', '22']");
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
      expect(hostInstaller).toContain('Node.js >=20.19.0 is required');
      expect(hostInstaller).toContain('major === 20 && minor >= 19');
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
