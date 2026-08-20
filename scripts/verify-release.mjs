#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { request as nodeHttpRequest } from 'node:http'
import { readFileSync, realpathSync } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const expectedTools = [
  'arch_diff',
  'connections',
  'diagram',
  'explore',
  'impact',
  'portfolio',
  'review',
  'rules',
  'scan',
  'status',
  'summary',
  'trace',
]

function note(message) {
  process.stdout.write(`verify: ${message}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed (${result.status ?? result.error?.message})`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return result.stdout.trim()
}

function runExpectFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error) throw result.error
  assert.notEqual(result.status, 0, `${command} ${args.join(' ')} must fail closed`)
  return `${result.stdout}\n${result.stderr}`
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' })
  return !result.error && result.status === 0
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

function countMatching(files, pattern) {
  return files.filter((file) => pattern.test(file)).length
}

function versionAtLeast(actual, minimum) {
  const left = actual.split('.').map((value) => Number.parseInt(value, 10))
  const right = minimum.split('.').map((value) => Number.parseInt(value, 10))
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta > 0
  }
  return true
}

async function runtimeFiles(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await runtimeFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

async function verifyDashboardPayload(packageDir) {
  const runtimeRoot = path.join(packageDir, 'web', 'runtime')
  const launcher = await readFile(path.join(packageDir, 'web', 'server.cjs'), 'utf8')
  assert.match(launcher, /HOSTNAME = '127\.0\.0\.1'/, 'packed dashboard direct launcher forces loopback')
  const nextPackage = await readJson(path.join(runtimeRoot, 'packages', 'next', 'package.json'))
  assert.ok(versionAtLeast(nextPackage.version, '16.2.10'), 'packed dashboard uses patched Next >=16.2.10')

  const forbidden = [repoRoot, os.homedir(), '.build-loop/worktrees/', '/home/runner/work/']
  for (const file of await runtimeFiles(runtimeRoot)) {
    const content = await readFile(file)
    for (const marker of forbidden) {
      assert.equal(
        content.includes(Buffer.from(marker)),
        false,
        `packed dashboard omits local build path ${marker} from ${path.relative(packageDir, file)}`,
      )
    }
  }
}

async function verifyIdentity(packageDir, packageJson) {
  const claudeManifest = await readJson(path.join(packageDir, '.claude-plugin', 'plugin.json'))
  const claudeMarketplace = await readJson(path.join(packageDir, '.claude-plugin', 'marketplace.json'))
  const codexManifest = await readJson(path.join(packageDir, '.codex-plugin', 'plugin.json'))
  const claudeEntry = claudeMarketplace.plugins.find((plugin) => plugin.name === 'navgator')

  assert.ok(claudeEntry, 'Claude marketplace must contain navgator')

  // package.json is the sole semver source of truth (99961eb); every plugin
  // surface above derives its identity from the git commit instead, so this
  // is the only place a real semver is required to exist.
  assert.match(
    packageJson.version ?? '',
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/,
    'package.json version must be present and valid semver',
  )

  for (const [label, manifest] of [
    ['Claude manifest', claudeManifest],
    ['Claude marketplace entry', claudeEntry],
    ['Codex manifest', codexManifest],
  ]) {
    assert.equal(manifest.name, 'navgator', `${label} name`)
    // Plugin manifests must OMIT version by policy (99961eb): NavGator is a
    // git-sourced plugin, and the host resolves identity from the commit SHA
    // so every push ships. Asserting equality only when present is the
    // permissive form that let a re-pin slip through undetected; the real
    // invariant is that the key is always absent. If this fails, remove
    // `version` from the manifest — package.json is the sole semver source of
    // truth, and detect_plugin_distribution.py is the tool that adjudicates
    // which surfaces may carry one.
    assert.equal(
      manifest.version,
      undefined,
      `${label} must omit version (git-sourced auto-SHA identity, 99961eb); ` +
        'remove the key — package.json is the sole semver source of truth ' +
        '(see detect_plugin_distribution.py)',
    )
    assert.equal(manifest.license, packageJson.license, `${label} license`)
  }

  // MCP is opt-in. Codex auto-loads whatever path this key names, so an absent
  // key is the registration-off switch on that host.
  assert.equal(
    codexManifest.mcpServers,
    undefined,
    'packed Codex manifest registers no MCP server by default',
  )

  const hooks = await readJson(path.join(packageDir, 'hooks', 'hooks.json'))
  assert.deepEqual(hooks, { hooks: {} }, 'hooks must remain empty')
}

/**
 * Assert a package tree carries neither host's auto-loaded MCP config.
 *
 * Claude auto-loads a root `.mcp.json` from the marketplace source it copies
 * into its plugin cache; Codex auto-loads the path named by its manifest's
 * `mcpServers` key. Both surfaces must be absent for a default install to
 * register zero MCP servers, which is the whole point of the demotion.
 */
async function assertNoDefaultMcp(packageDir, label) {
  await assert.rejects(
    access(path.join(packageDir, '.mcp.json')),
    `${label} ships no root .mcp.json (Claude MCP is opt-in)`,
  )
  await assert.rejects(
    access(path.join(packageDir, '.codex-plugin', 'mcp.json')),
    `${label} ships no Codex MCP config (Codex MCP is opt-in)`,
  )
  const codexManifest = await readJson(path.join(packageDir, '.codex-plugin', 'plugin.json'))
  assert.equal(
    codexManifest.mcpServers,
    undefined,
    `${label} Codex manifest declares no MCP server`,
  )
}

/**
 * Assert the opt-in templates keep their host-specific process resolution.
 *
 * This is the property the deleted `.mcp.json` / `.codex-plugin/mcp.json`
 * shape assertions protected: Claude resolves through the plugin root it
 * exports, Codex resolves relative to the package it copied into its cache.
 * Only the file locations moved.
 */
async function assertMcpOptInTemplates(packageDir) {
  const claude = (await readJson(path.join(packageDir, 'mcp-optin', 'claude.mcp.json'))).mcpServers?.navgator
  assert.ok(claude, 'Claude opt-in template defines navgator')
  assert.equal(claude.command, 'node', 'Claude opt-in template launches node')
  assert.ok(
    claude.args?.[0]?.includes('${CLAUDE_PLUGIN_ROOT}'),
    'Claude opt-in template resolves through the exported plugin root',
  )

  const codex = (await readJson(path.join(packageDir, 'mcp-optin', 'codex.mcp.json'))).mcpServers?.navgator
  assert.ok(codex, 'Codex opt-in template defines navgator')
  assert.deepEqual(
    codex,
    { command: 'node', args: ['dist/mcp/server.js'], cwd: '.' },
    'Codex opt-in template stays package-relative',
  )
  assert.equal(
    JSON.stringify(codex).includes('CLAUDE_PLUGIN_ROOT'),
    false,
    'Codex opt-in template does not borrow the Claude plugin root',
  )

  await access(path.join(packageDir, 'mcp-optin', 'README.md'))
}

function resolveMcpLaunch(packageDir, configPath, fallbackCwd = packageDir) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const server = config.mcpServers?.navgator
  assert.ok(server, `MCP config must define navgator: ${configPath}`)

  const args = server.args.map((arg) =>
    arg.replaceAll('${CLAUDE_PLUGIN_ROOT}', packageDir)
  )
  const cwd = server.cwd ? path.resolve(packageDir, server.cwd) : fallbackCwd
  return { server, args, cwd }
}

/**
 * Home directory the MCP probes run under.
 *
 * The `scan` tool calls `registerProject()`, which writes
 * `~/.navgator/projects.json`. Without this redirect the probes inherit the
 * real HOME and register their own throwaway temp workspaces into the
 * developer's actual registry — measured on 2026-08-03: two entries pointing
 * at `navgator-release-<id>/codex-<scope>-cache-workspace`, both already
 * deleted by the time the run finished.
 *
 * That is the same defect class the vitest `setupFiles` hook closed for
 * `npm test` (see `src/__tests__/setup/home-redirect.ts`), reached by a
 * different path: a release verifier is a test too, and a verifier that
 * mutates the machine it is verifying is not hermetic.
 *
 * Set once per run from `main()`. Left null the probes simply inherit, which
 * keeps this file runnable piecemeal.
 */
let mcpProbeHome = null

function setMcpProbeHome(dir) {
  mcpProbeHome = dir
}

/** Env overlay isolating an MCP probe from the real home. */
function mcpProbeEnv() {
  if (!mcpProbeHome) return {}
  return { HOME: mcpProbeHome, USERPROFILE: mcpProbeHome }
}

function probeMcp(packageDir, configPath, host, options = {}) {
  const { server, args, cwd } = resolveMcpLaunch(
    packageDir,
    configPath,
    options.cwd ?? packageDir,
  )
  assert.equal(server.command, 'node', `${host} MCP command`)
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    '',
  ].join('\n')
  const output = run(server.command, args, { cwd, input, timeout: 10_000, env: mcpProbeEnv() })
  const responses = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  const initialized = responses.find((response) => response.id === 1)
  const listed = responses.find((response) => response.id === 2)

  assert.equal(initialized?.result?.serverInfo?.name, 'navgator', `${host} MCP initialized`)
  const tools = listed?.result?.tools?.map((tool) => tool.name).sort()
  assert.deepEqual(tools, expectedTools, `${host} MCP exposes the expected 12 tools`)
  return initialized.result.serverInfo.version
}

function probeMcpTool(packageDir, configPath, host, cwd, name, args = {}) {
  const launch = resolveMcpLaunch(packageDir, configPath, cwd)
  assert.equal(launch.server.command, 'node', `${host} MCP command`)
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'notifications/initialized', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }),
    '',
  ].join('\n')
  const output = run(launch.server.command, launch.args, {
    cwd: launch.cwd,
    input,
    timeout: 20_000,
    env: mcpProbeEnv(),
  })
  const responses = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  const called = responses.find((response) => response.id === 3)
  assert.ok(called?.result, `${host} MCP ${name} returned a result; output=${output}`)
  assert.equal(called.result.isError, undefined, `${host} MCP ${name} did not return an error`)
  return called.result.content?.map((item) => item.text ?? '').join('\n') ?? ''
}

/**
 * Run an installed CLI entrypoint and return its parsed `--agent` envelope.
 *
 * This is the default-surface counterpart to `probeMcpTool`. The separation
 * that matters is the same one the MCP probe measured: `packageDir` is the
 * installed runtime (a host's versioned cache), `cwd` is the ACTIVE task
 * workspace. A CLI call resolves its project from `cwd`, so a passing probe
 * proves the cache executes against the task root and not its own package root.
 *
 * Timeouts are explicit and generous — CI runs on 2 cores.
 */
function probeCli(packageDir, cwd, label, args, timeout) {
  const entry = path.join(packageDir, 'dist', 'cli', 'index.js')
  const output = run('node', [entry, ...args], { cwd, timeout, env: mcpProbeEnv() })
  assert.ok(
    output.startsWith('{'),
    `${label} CLI emits a JSON agent envelope: ${output.slice(0, 200)}`,
  )
  const envelope = JSON.parse(output)
  assert.equal(envelope.command, args[0], `${label} CLI envelope names the ${args[0]} command`)
  assert.ok(envelope.data, `${label} CLI envelope carries data`)
  return envelope.data
}

/**
 * `status --agent` emits the `{command, data, schema_version, timestamp}`
 * envelope rather than the MCP tool's `Components: N` text, so the counts are
 * read from `data.stats`. `--no-refresh` suppresses the staleness auto-scan so
 * the fixture counts stay deterministic on a slow runner; the MCP `status`
 * handler called the same `autoRefreshIfStale` and was latently exposed to it.
 */
function probeCliStatus(packageDir, cwd, label) {
  return probeCli(packageDir, cwd, label, ['status', '--agent', '--no-refresh'], 60_000)
}

function probeCliScan(packageDir, cwd, label) {
  return probeCli(packageDir, cwd, label, ['scan', '--quick', '--agent'], 180_000)
}

function assertMaterializedCodexMcp(packageDir, label, entryPackageDir = packageDir) {
  const configPath = path.join(packageDir, '.codex-plugin', 'mcp.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const server = config.mcpServers?.navgator
  const expectedEntry = path.resolve(entryPackageDir, 'dist', 'mcp', 'server.js')
  assert.ok(server, `${label} defines NavGator MCP`)
  assert.equal(server.cwd, undefined, `${label} omits cwd so Codex uses the active task workspace`)
  assert.ok(path.isAbsolute(server.args?.[0] ?? ''), `${label} uses an absolute MCP entry`)
  assert.equal(path.resolve(server.args[0]), expectedEntry, `${label} MCP entry targets the intended runtime`)
  try {
    assert.equal(
      realpathSync(server.args[0]),
      realpathSync(expectedEntry),
      `${label} MCP entry resolves to the intended runtime`,
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return configPath
}

function assertCodexSkillsFromCache(result, cacheDir, workspace, label) {
  const entry = result.data?.find((item) => realpathSync(item.cwd) === realpathSync(workspace))
  assert.ok(entry, `${label} returns skills for the task workspace`)
  assert.deepEqual(entry.errors, [], `${label} loads skills without errors`)

  const expectedNames = [
    'architecture-export',
    'architecture-scan',
    'code-review',
    'impact-analysis',
    'infrastructure-scanning',
    'navgator-setup',
  ]
  const canonicalCache = realpathSync(cacheDir)
  const cacheSkills = entry.skills.filter((skill) => {
    if (typeof skill.path !== 'string') return false
    const relative = path.relative(canonicalCache, realpathSync(skill.path))
    const insideCache =
      relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    if (!insideCache) return false
    // Ignore skills the HOST generated inside the cache rather than ones
    // NavGator ships. Codex >= ~0.14x materializes
    // `.codex-plugin/migrated-command-skills/source-command-<name>/SKILL.md`
    // for some commands at install time, so on codex 0.146.0 this assertion
    // saw 9 where the repo ships 6 — a failure that says nothing about
    // NavGator's surface and everything about the host's version.
    //
    // This is a no-op on the CI-pinned 0.130.0, which generates no such
    // directory. Scoping the assertion to `skills/` keeps it measuring the
    // thing it is named for — the skills NavGator ships — instead of
    // re-breaking every time a host changes what else it writes into its own
    // cache.
    return !relative.split(path.sep).includes('.codex-plugin')
  })
  assert.equal(cacheSkills.length, 6, `${label} exposes exactly six skills from the installed cache`)
  assert.deepEqual(
    cacheSkills.map((skill) => skill.name.split(':').at(-1)).sort(),
    expectedNames,
    `${label} exposes the intended NavGator skills`,
  )
  const architectureScan = cacheSkills.find(
    (skill) => skill.name.split(':').at(-1) === 'architecture-scan',
  )
  assert.ok(architectureScan?.path, `${label} exposes architecture-scan with a source path`)
  const loadedPluginRoot = realpathSync(path.dirname(path.dirname(path.dirname(architectureScan.path))))
  assert.equal(loadedPluginRoot, canonicalCache, `${label} loads skills from the installed plugin cache`)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function rawHttpRequest(url, options = {}) {
  return await new Promise((resolve, reject) => {
    const request = nodeHttpRequest(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.setTimeout(options.timeout ?? 3_000, () => {
      request.destroy(new Error(`HTTP request timed out: ${url}`))
    })
    request.on('error', reject)
    if (options.body) request.write(options.body)
    request.end()
  })
}

async function probeDirectDashboardLoopback(packageDir, projectPath) {
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(packageDir, 'web', 'server.cjs')], {
    cwd: packageDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '0.0.0.0',
      NAVGATOR_PROJECT_PATH: projectPath,
      NAVGATOR_CLI_ENTRY: path.join(packageDir, 'dist', 'cli', 'index.js'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })

  try {
    let healthy = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(500),
        })
        if (response.status === 200) {
          healthy = true
          break
        }
      } catch {
        // Server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(healthy, true, `direct packed dashboard launcher becomes healthy: ${output}`)

    const external = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === 'IPv4' && !entry.internal)
    if (external) {
      await assert.rejects(
        fetch(`http://${external.address}:${port}/`, { signal: AbortSignal.timeout(750) }),
        'direct packed dashboard rejects non-loopback connections even with ambient HOSTNAME=0.0.0.0',
      )
    }
  } finally {
    child.kill('SIGTERM')
  }
}

async function probeDashboard(packageDir, tempRoot) {
  const port = await freePort()
  const expectedVersion = (await readJson(path.join(packageDir, 'package.json'))).version
  const miscUrl = pathToFileURL(path.join(packageDir, 'dist', 'cli', 'commands', 'misc.js'))
  const { launchWebUI } = await import(`${miscUrl.href}?verify=${Date.now()}`)
  const dashboardHome = path.join(tempRoot, 'dashboard-home')
  const dashboardProject = path.join(tempRoot, 'dashboard-project')
  const dashboardScanProject = path.join(tempRoot, 'dashboard-scan-project')
  const architectureDir = path.join(dashboardProject, '.navgator', 'architecture')
  await mkdir(dashboardHome, { recursive: true })
  await mkdir(architectureDir, { recursive: true })
  await mkdir(path.join(dashboardScanProject, 'src'), { recursive: true })
  await writeFile(path.join(dashboardScanProject, 'package.json'), JSON.stringify({
    name: 'dashboard-scan-fixture',
    version: '1.0.0',
    dependencies: { commander: '^14.0.0' },
  }))
  await writeFile(
    path.join(dashboardScanProject, 'src', 'index.ts'),
    "import { Command } from 'commander'\nexport const program = new Command()\n",
  )
  const generatedAt = Date.now()
  await writeFile(path.join(architectureDir, 'graph.json'), JSON.stringify({
    schema_version: '1.0.0',
    nodes: [
      { id: 'COMP_web', name: 'Web', type: 'component', layer: 'frontend' },
      { id: 'COMP_db', name: 'Database', type: 'database', layer: 'database' },
      { id: 'COMP_queue', name: 'Queue', type: 'queue', layer: 'queue' },
    ],
    edges: [
      { id: 'CONN_web_db', source: 'COMP_web', target: 'COMP_db', type: 'api-calls-db' },
      { id: 'CONN_queue_db', source: 'COMP_queue', target: 'COMP_db', type: 'queue-uses-cache' },
    ],
    metadata: { generated_at: generatedAt, component_count: 3, connection_count: 2 },
  }))
  const fullComponents = [
    {
      component_id: 'COMP_web',
      name: 'Web',
      version: '1.2.3',
      type: 'component',
      role: { layer: 'frontend', purpose: 'UI' },
      source: { config_files: ['src/web.ts'] },
      status: 'active',
      tags: ['ui'],
    },
    {
      component_id: 'COMP_db',
      name: 'Database',
      type: 'database',
      role: { layer: 'database', purpose: 'Storage' },
      source: { config_files: ['schema.sql'] },
      status: 'vulnerable',
      tags: ['data'],
    },
    {
      component_id: 'COMP_queue',
      name: 'Queue',
      type: 'queue',
      role: { layer: 'queue', purpose: 'Jobs' },
      source: { config_files: ['src/queue.ts'] },
      status: 'active',
      tags: ['jobs'],
    },
  ]
  await writeFile(
    path.join(architectureDir, 'components.full.jsonl'),
    `${fullComponents.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )
  const fullConnections = [
    {
      connection_id: 'CONN_web_db',
      from: { component_id: 'COMP_web' },
      to: { component_id: 'COMP_db' },
      connection_type: 'api-calls-db',
      code_reference: { file: 'src/web.ts', line_start: 7, symbol: 'loadData' },
      confidence: 1,
      semantic: { classification: 'production' },
    },
    {
      connection_id: 'CONN_queue_db',
      from: { component_id: 'COMP_queue' },
      to: { component_id: 'COMP_db' },
      connection_type: 'queue-uses-cache',
      code_reference: { file: 'src/queue.ts', line_start: 9, symbol: 'connectQueue' },
      confidence: 1,
      semantic: { classification: 'production' },
    },
  ]
  await writeFile(
    path.join(architectureDir, 'connections.full.jsonl'),
    `${fullConnections.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )
  await writeFile(
    path.join(architectureDir, 'connections.jsonl'),
    `${fullConnections.map((record) => JSON.stringify({
      connection_id: record.connection_id,
      from_id: record.from.component_id,
      to_id: record.to.component_id,
      type: 'other',
    })).join('\n')}\n`,
  )
  await writeFile(path.join(architectureDir, 'index.json'), JSON.stringify({
    last_scan: generatedAt,
    stats: {
      total_components: 3,
      total_connections: 2,
      components_by_type: { component: 1, database: 1, queue: 1 },
      connections_by_type: { 'api-calls-db': 1, 'queue-uses-cache': 1 },
      outdated_count: 0,
      vulnerable_count: 1,
    },
  }))
  const traceStressProject = path.join(tempRoot, 'dashboard-trace-stress')
  const traceStressDir = path.join(traceStressProject, '.navgator', 'architecture')
  await mkdir(traceStressDir, { recursive: true })
  const traceStressComponents = Array.from({ length: 14 }, (_, index) => ({
    component_id: `COMP_stress_${index}`,
    name: `Stress${index}`,
    type: 'service',
    role: { layer: 'backend', purpose: 'Trace bound verification' },
    source: { config_files: [`src/stress-${index}.ts`] },
    status: 'active',
    tags: ['trace-stress'],
  }))
  const traceStressConnections = []
  for (let from = 0; from < traceStressComponents.length; from += 1) {
    for (let to = 0; to < traceStressComponents.length; to += 1) {
      if (from === to) continue
      traceStressConnections.push({
        connection_id: `CONN_stress_${from}_${to}`,
        from: { component_id: `COMP_stress_${from}` },
        to: { component_id: `COMP_stress_${to}` },
        connection_type: 'service-call',
        confidence: 1,
        semantic: { classification: 'production' },
      })
    }
  }
  await writeFile(
    path.join(traceStressDir, 'components.full.jsonl'),
    `${traceStressComponents.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )
  await writeFile(
    path.join(traceStressDir, 'connections.full.jsonl'),
    `${traceStressConnections.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )
  await probeDirectDashboardLoopback(packageDir, dashboardProject)
  const priorHome = process.env.HOME
  let launched
  try {
    process.env.HOME = dashboardHome
    launched = await launchWebUI({
      port,
      projectPath: dashboardProject,
    })
  } finally {
    if (priorHome === undefined) delete process.env.HOME
    else process.env.HOME = priorHome
  }
  const child = launched.process
  assert.equal(launched.port, port, 'CLI dashboard helper preserves the selected port')

  // SEC-001/SEC-009: the 0600 session file is the ONLY way a non-browser
  // local client can obtain the session token now that it no longer travels
  // through any URL, so its mode is load-bearing rather than decorative.
  const sessionFile = path.join(dashboardHome, '.navgator', 'dashboard-session.json')
  const sessionStat = await stat(sessionFile)
  assert.equal(
    sessionStat.mode & 0o777,
    0o600,
    'dashboard session file is readable only by the invoking user',
  )
  const sessionRecord = await readJson(sessionFile)
  assert.equal(sessionRecord.token, launched.token, 'session file carries the session token')
  assert.equal(
    JSON.stringify(sessionRecord).includes(launched.bootstrapNonce),
    false,
    'session file does not also store the bootstrap nonce',
  )
  assert.equal(
    path.resolve(child.spawnargs[1]),
    path.join(packageDir, 'web', 'server.cjs'),
    'CLI dashboard helper launches the packed server entry',
  )
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })

  try {
    let lastError
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(1_000),
        })
        if (response.status === 200) {
          const csp = response.headers.get('content-security-policy') ?? ''
          assert.match(csp, /frame-ancestors 'none'/, 'packed dashboard denies framing with CSP')
          // SEC-006: without a script-src, nothing constrained where script in
          // this privileged origin could come from — and a remote analytics
          // script was in fact being injected in dev. The packed build must
          // also NOT carry the dev-only 'unsafe-eval'.
          assert.match(csp, /script-src 'self' 'unsafe-inline'/, 'packed dashboard constrains script-src to self')
          assert.equal(
            csp.includes("'unsafe-eval'"),
            false,
            "packed dashboard omits 'unsafe-eval' (development-only)",
          )
          assert.equal(response.headers.get('x-frame-options'), 'DENY', 'packed dashboard denies framing')

          // ---- SEC-001 trust boundary, exercised live against the packed
          // server. Loopback proves the request came from this machine; the
          // per-launch token proves it came from `navgator ui`. Both are
          // asserted here rather than only in unit tests, because this is the
          // only place the REAL standalone build runs — a proxy that silently
          // stopped being wired into the bundle would pass every unit test.
          const authHeaders = { 'x-navgator-token': launched.token }

          const noTokenRead = await fetch(`http://127.0.0.1:${port}/api/components`, {
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(noTokenRead.status, 401, 'untokened local API read is rejected')

          const wrongTokenRead = await fetch(`http://127.0.0.1:${port}/api/components`, {
            headers: { 'x-navgator-token': 'x'.repeat(launched.token.length) },
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(wrongTokenRead.status, 401, 'wrong-token local API read is rejected')

          // HIGH-1: the browser-open URL is an argv, and `ps -axww` shows
          // other users' full argv. Assert on the EXACT string the CLI hands
          // to the browser-open call — the session token must not be in it.
          assert.notEqual(launched.bootstrapNonce, launched.token, 'bootstrap nonce is a distinct secret')
          assert.equal(
            launched.bootstrapUrl.includes(launched.token),
            false,
            'browser-open URL (an argv) does not carry the session token',
          )
          assert.ok(
            launched.bootstrapUrl.includes(launched.bootstrapNonce),
            'browser-open URL carries the single-use bootstrap nonce',
          )

          // The nonce redeems ONCE, into a URL FRAGMENT. A fragment is never
          // transmitted to a server and is stripped from Referer, so the
          // session token never crosses a network boundary again.
          const bootstrap = await fetch(launched.bootstrapUrl.replace('localhost', '127.0.0.1'), {
            redirect: 'manual',
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(bootstrap.status, 302, 'bootstrap nonce redirects')
          // HIGH-2: no cookie anywhere. A `localhost` cookie ignores port
          // (RFC 6265 s8.5), so it would be broadcast to every other
          // localhost server the browser visits.
          assert.equal(bootstrap.headers.get('set-cookie'), null, 'bootstrap sets NO cookie') // nosec: asserts the ABSENCE of Set-Cookie — this is the test for the cookie issue, not an instance of it
          const location = bootstrap.headers.get('location') ?? ''
          assert.ok(location.includes(`#t=${launched.token}`), 'bootstrap hands the token over in a fragment')
          assert.equal(
            location.split('#')[0].includes(launched.token),
            false,
            'bootstrap redirect does not leak the token outside the fragment',
          )

          // Replay: this is the `ps`-reading attacker. The nonce is burned.
          const replay = await fetch(launched.bootstrapUrl.replace('localhost', '127.0.0.1'), {
            redirect: 'manual',
            signal: AbortSignal.timeout(2_000),
          })
          assert.notEqual(replay.status, 302, 'a replayed bootstrap nonce does not redirect')
          assert.equal(replay.headers.get('location'), null, 'a replayed nonce yields no redirect target')
          assert.equal(
            JSON.stringify([...replay.headers]).includes(launched.token),
            false,
            'a replayed nonce yields no credential',
          )

          // A stale cookie from the previous design must not authenticate.
          const cookieRead = await fetch(`http://127.0.0.1:${port}/api/components`, {
            headers: { cookie: `navgator_session=${launched.token}` },
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(cookieRead.status, 401, 'a session cookie no longer authorizes API reads')

          // f2: the guard reads a stamp only the proxy can produce. A
          // client-supplied copy is stripped on every path.
          const forgedStamp = await fetch(`http://127.0.0.1:${port}/api/components`, {
            headers: { 'x-navgator-proxy-verified': '1' },
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(forgedStamp.status, 401, 'a client-supplied proxy-verified stamp authorizes nothing')

          // SEC-005: deny-by-default. A route that does not exist yet must
          // still be gated, not fall through unauthenticated.
          const unlistedRoute = await fetch(`http://127.0.0.1:${port}/some-future-route`, {
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(unlistedRoute.status, 401, 'a non-/api route is authenticated by default')

          const routes = [
            '/api/components',
            '/api/connections',
            '/api/status',
            '/api/projects',
            '/api/rules',
            '/api/graph',
            '/api/trace?component=Web',
            '/api/subgraph?focus=Web',
          ]
          for (const route of routes) {
            const apiResponse = await fetch(`http://127.0.0.1:${port}${route}`, {
              headers: authHeaders,
              signal: AbortSignal.timeout(2_000),
            })
            assert.equal(apiResponse.status, 200, `dashboard ${route} returns HTTP 200`)
            const payload = await apiResponse.json()
            assert.equal(payload.success, true, `dashboard ${route} returns a successful payload`)
            if (route === '/api/components') {
              assert.equal(payload.data.components.length, 3, 'dashboard loads consolidated components')
              assert.equal(payload.data.summary.totalComponents, 3, 'component summary uses fixture data')
              assert.ok(
                payload.data.components.some(
                  (component) => component.type === 'component' && component.version === '1.2.3',
                ),
                'dashboard preserves full component type and version',
              )
              assert.ok(
                payload.data.components.some(
                  (component) => component.layer === 'database' && component.status === 'vulnerable',
                ),
                'dashboard preserves full component layer and status',
              )
            } else if (route === '/api/connections') {
              assert.equal(payload.data.connections.length, 2, 'dashboard loads full JSONL connections')
              assert.ok(
                payload.data.connections.some((connection) => connection.type === 'queue-uses-cache'),
                'dashboard preserves uncommon connection types',
              )
            } else if (route === '/api/status') {
              assert.equal(payload.data.stats.total_components, 3, 'dashboard status uses fixture index')
            } else if (route === '/api/rules') {
              assert.equal(payload.data.summary.errors, 2, 'dashboard rules evaluate full consolidated data')
            } else if (route === '/api/graph') {
              assert.equal(payload.data.nodes.length, 3, 'dashboard graph uses fixture nodes')
              assert.ok(
                payload.data.nodes.some((node) => node.version === '1.2.3'),
                'dashboard graph enriches nodes from full records',
              )
            } else if (route.startsWith('/api/trace')) {
              assert.ok(payload.data.components_touched.length >= 2, 'dashboard trace traverses fixture edge')
            } else if (route.startsWith('/api/subgraph')) {
              assert.equal(payload.data.stats.nodes, 3, 'dashboard subgraph uses fixture nodes')
              assert.equal(payload.data.stats.edges, 2, 'dashboard subgraph uses fixture edges')
            }
          }

          const scanHealth = await fetch(`http://127.0.0.1:${port}/api/scan`, {
            headers: authHeaders,
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(scanHealth.status, 200, 'packed dashboard scan health returns HTTP 200')
          const scanHealthPayload = await scanHealth.json()
          assert.equal(scanHealthPayload.available, true, 'packed dashboard resolves its packaged CLI entry')
          assert.equal(scanHealthPayload.version, expectedVersion, 'packed dashboard executes the packaged CLI version')

          // SEC-007: /api/scan only accepts a path the registry knows about,
          // so a scan can no longer create a .navgator/ tree in an arbitrary
          // directory. Register the fixture first, through the real
          // POST /api/projects path the dashboard's own "add project" button
          // uses — the UI never scans an unregistered path either (header.tsx
          // scans `activeProject`, which comes from the project list). This
          // makes the probe exercise the genuine register-then-scan flow
          // rather than a shape no user can produce.
          for (const fixture of [dashboardScanProject, traceStressProject]) {
            const registered = await fetch(`http://127.0.0.1:${port}/api/projects`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                origin: `http://127.0.0.1:${port}`,
                'sec-fetch-site': 'same-origin',
                ...authHeaders,
              },
              body: JSON.stringify({ action: 'add', path: fixture }),
              signal: AbortSignal.timeout(10_000),
            })
            assert.equal(registered.status, 200, `fixture ${path.basename(fixture)} registers through the dashboard`)
          }

          const unregisteredScan = await fetch(`http://127.0.0.1:${port}/api/scan`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: `http://127.0.0.1:${port}`,
              'sec-fetch-site': 'same-origin',
              ...authHeaders,
            },
            body: JSON.stringify({ path: path.join(tempRoot, 'never-registered'), prompts: false }),
            signal: AbortSignal.timeout(10_000),
          })
          assert.equal(unregisteredScan.status, 403, 'scan of an unregistered path is rejected')

          const scanResponse = await fetch(`http://127.0.0.1:${port}/api/scan`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: `http://127.0.0.1:${port}`,
              'sec-fetch-site': 'same-origin',
              ...authHeaders,
            },
            body: JSON.stringify({ path: dashboardScanProject, prompts: false }),
            signal: AbortSignal.timeout(20_000),
          })
          assert.equal(scanResponse.status, 200, 'packed dashboard scan mutation returns HTTP 200')
          const scanPayload = await scanResponse.json()
          assert.equal(scanPayload.success, true, 'packed dashboard scan reports success')
          assert.ok(['completed', 'noop'].includes(scanPayload.status), 'packed dashboard preserves scan status')
          assert.ok(scanPayload.results.components > 0, 'packed dashboard returns typed component count')
          assert.equal(typeof scanPayload.results.connections, 'number', 'packed dashboard returns typed connection count')
          assert.equal(typeof scanPayload.results.prompts, 'number', 'packed dashboard returns typed prompt count')

          const clampedSubgraph = await fetch(
            `http://127.0.0.1:${port}/api/subgraph?focus=Web&depth=-100&maxNodes=-100`,
            { headers: authHeaders, signal: AbortSignal.timeout(2_000) },
          )
          assert.equal(clampedSubgraph.status, 200, 'bounded subgraph accepts clamped integer inputs')
          const clampedSubgraphPayload = await clampedSubgraph.json()
          assert.equal(clampedSubgraphPayload.data.stats.nodes, 1, 'subgraph clamps depth and maxNodes safely')

          const stressUrl = new URL(`http://127.0.0.1:${port}/api/trace`)
          stressUrl.searchParams.set('component', 'Stress0')
          stressUrl.searchParams.set('maxDepth', '10')
          stressUrl.searchParams.set('maxPaths', '10')
          stressUrl.searchParams.set('path', traceStressProject)
          const stressResponse = await fetch(stressUrl, { headers: authHeaders, signal: AbortSignal.timeout(3_000) })
          assert.equal(stressResponse.status, 200, 'dense trace returns within the bounded deadline')
          const stressPayload = await stressResponse.json()
          assert.equal(stressPayload.success, true, 'dense trace returns a successful payload')
          assert.ok(stressPayload.data.paths.length <= 10, 'dense trace respects maxPaths')
          assert.equal(stressPayload.data.truncated, true, 'dense trace reports bounded truncation')

          const denseSubgraphUrl = new URL(`http://127.0.0.1:${port}/api/subgraph`)
          denseSubgraphUrl.searchParams.set('focus', 'Stress0')
          denseSubgraphUrl.searchParams.set('depth', '5')
          denseSubgraphUrl.searchParams.set('maxNodes', '5')
          denseSubgraphUrl.searchParams.set('path', traceStressProject)
          const denseSubgraph = await fetch(denseSubgraphUrl, { headers: authHeaders, signal: AbortSignal.timeout(3_000) })
          assert.equal(denseSubgraph.status, 200, 'dense subgraph returns within the bounded deadline')
          const denseSubgraphPayload = await denseSubgraph.json()
          assert.equal(denseSubgraphPayload.data.stats.nodes, 5, 'dense subgraph respects maxNodes')

          const settingsUrl = `http://127.0.0.1:${port}/api/settings`
          const settingsPath = path.join(dashboardProject, '.navgator', 'settings.json')
          const crossSiteResponse = await fetch(settingsUrl, {
            method: 'POST',
            headers: {
              'content-type': 'text/plain',
              origin: 'http://evil.example',
              'sec-fetch-site': 'cross-site',
              ...authHeaders,
            },
            body: JSON.stringify({ projectPath: dashboardProject, display: { compactMode: true } }),
          })
          assert.ok(
            crossSiteResponse.status === 403 || crossSiteResponse.status === 415,
            'cross-site simple mutation is rejected',
          )
          await assert.rejects(access(settingsPath), 'rejected mutation does not write settings')

          const reboundBody = JSON.stringify({
            projectPath: dashboardProject,
            display: { compactMode: true },
          })
          const reboundMutation = await rawHttpRequest(settingsUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(reboundBody),
              host: 'evil.example',
              origin: 'http://evil.example',
            },
            body: reboundBody,
          })
          assert.equal(reboundMutation.status, 403, 'DNS-rebound mutation hostname is rejected')
          await assert.rejects(access(settingsPath), 'DNS-rebound mutation does not write settings')

          const reboundRead = await rawHttpRequest(`http://127.0.0.1:${port}/api/components`, {
            headers: { host: 'evil.example' },
          })
          assert.equal(reboundRead.status, 403, 'DNS-rebound API read hostname is rejected')

          const validMutation = await fetch(settingsUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: `http://127.0.0.1:${port}`,
              'sec-fetch-site': 'same-origin',
              ...authHeaders,
            },
            body: JSON.stringify({ projectPath: dashboardProject, display: { compactMode: true } }),
          })
          assert.equal(validMutation.status, 200, 'same-origin JSON settings mutation succeeds')
          const validMutationPayload = await validMutation.json()
          assert.equal(validMutationPayload.success, true, 'same-origin settings payload succeeds')
          const savedSettings = await readJson(settingsPath)
          assert.equal(savedSettings.display.compactMode, true, 'valid settings mutation persists')
          return
        }
        lastError = new Error(`dashboard returned HTTP ${response.status}`)
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`dashboard did not become healthy: ${lastError?.message ?? output}`)
  } finally {
    child.kill('SIGTERM')
  }
}

async function assertInstallerSymlinkRejected({
  label,
  installer,
  args,
  cwd,
  env,
  linkPath,
  victimPath,
  victimKind = 'directory',
  timeout,
}) {
  await mkdir(path.dirname(linkPath), { recursive: true })
  let markerPath
  if (victimKind === 'file') {
    await mkdir(path.dirname(victimPath), { recursive: true })
    markerPath = victimPath
  } else {
    await mkdir(victimPath, { recursive: true })
    markerPath = path.join(victimPath, 'sentinel.txt')
  }
  await writeFile(markerPath, `${label}: unchanged\n`)
  const before = await readFile(markerPath, 'utf8')
  await symlink(victimPath, linkPath, victimKind === 'file' ? 'file' : 'dir')

  // Guards that fire before materialization return in milliseconds; the opt-in
  // MCP guards fire after two npm installs, so those callers pass a timeout.
  const output = runExpectFailure('bash', [installer, ...args], { cwd, env, timeout })
  assert.match(output, /Refusing symlinked destination component|Destination root must be a real directory/, `${label} rejects the symlink`)
  assert.equal(await readFile(markerPath, 'utf8'), before, `${label} leaves victim content unchanged`)
}

async function probeInstallerSymlinkGuards(packageDir, tempRoot) {
  const codexInstaller = path.join(packageDir, 'scripts', 'install-codex-plugin.sh')
  const claudeInstaller = path.join(packageDir, 'scripts', 'install-plugin.sh')
  const guardRoot = path.join(tempRoot, 'installer-symlink-guards')
  await mkdir(guardRoot, { recursive: true })

  const codexUserAgents = path.join(guardRoot, 'codex-user-agents')
  await mkdir(path.join(codexUserAgents, '.codex'), { recursive: true })
  await assertInstallerSymlinkRejected({
    label: 'Codex user .agents guard',
    installer: codexInstaller,
    args: ['--user'],
    cwd: codexUserAgents,
    env: {
      HOME: codexUserAgents,
      CODEX_HOME: path.join(codexUserAgents, '.codex'),
      NAVGATOR_PACKAGE_SOURCE: packageDir,
    },
    linkPath: path.join(codexUserAgents, '.agents'),
    victimPath: path.join(guardRoot, 'victim-user-agents'),
  })

  const codexUserHome = path.join(guardRoot, 'codex-user-home')
  await mkdir(codexUserHome, { recursive: true })
  await assertInstallerSymlinkRejected({
    label: 'Codex user .codex guard',
    installer: codexInstaller,
    args: ['--user'],
    cwd: codexUserHome,
    env: {
      HOME: codexUserHome,
      CODEX_HOME: path.join(codexUserHome, '.codex'),
      NAVGATOR_PACKAGE_SOURCE: packageDir,
    },
    linkPath: path.join(codexUserHome, '.codex'),
    victimPath: path.join(guardRoot, 'victim-user-codex'),
  })

  const codexWorkspace = path.join(guardRoot, 'codex-workspace-marketplace')
  const codexWorkspaceHome = path.join(guardRoot, 'codex-workspace-home')
  await mkdir(path.join(codexWorkspace, '.agents', 'plugins'), { recursive: true })
  await mkdir(path.join(codexWorkspaceHome, '.codex'), { recursive: true })
  await assertInstallerSymlinkRejected({
    label: 'Codex workspace marketplace guard',
    installer: codexInstaller,
    args: ['--workspace'],
    cwd: codexWorkspace,
    env: {
      HOME: codexWorkspaceHome,
      CODEX_HOME: path.join(codexWorkspaceHome, '.codex'),
      NAVGATOR_WORKSPACE_ROOT: codexWorkspace,
      NAVGATOR_PACKAGE_SOURCE: packageDir,
    },
    linkPath: path.join(codexWorkspace, '.agents', 'plugins', 'marketplace.json'),
    victimPath: path.join(guardRoot, 'victim-marketplace.json'),
    victimKind: 'file',
  })

  const codexWorkspaceRoot = path.join(guardRoot, 'codex-workspace-root')
  const codexWorkspaceRootHome = path.join(guardRoot, 'codex-workspace-root-home')
  await mkdir(codexWorkspaceRoot, { recursive: true })
  await mkdir(path.join(codexWorkspaceRootHome, '.codex'), { recursive: true })
  await assertInstallerSymlinkRejected({
    label: 'Codex workspace .codex guard',
    installer: codexInstaller,
    args: ['--workspace'],
    cwd: codexWorkspaceRoot,
    env: {
      HOME: codexWorkspaceRootHome,
      CODEX_HOME: path.join(codexWorkspaceRootHome, '.codex'),
      NAVGATOR_WORKSPACE_ROOT: codexWorkspaceRoot,
      NAVGATOR_PACKAGE_SOURCE: packageDir,
    },
    linkPath: path.join(codexWorkspaceRoot, '.codex'),
    victimPath: path.join(guardRoot, 'victim-workspace-codex'),
  })

  const claudeUserHome = path.join(guardRoot, 'claude-user-home')
  await mkdir(claudeUserHome, { recursive: true })
  await assertInstallerSymlinkRejected({
    label: 'Claude user .claude guard',
    installer: claudeInstaller,
    args: ['--global'],
    cwd: claudeUserHome,
    env: {
      HOME: claudeUserHome,
      CLAUDE_CONFIG_DIR: '',
      NAVGATOR_PACKAGE_SOURCE: packageDir,
    },
    linkPath: path.join(claudeUserHome, '.claude'),
    victimPath: path.join(guardRoot, 'victim-user-claude'),
  })

  const claudeWorkspace = path.join(guardRoot, 'claude-workspace')
  const claudeWorkspaceHome = path.join(guardRoot, 'claude-workspace-home')
  await mkdir(claudeWorkspace, { recursive: true })
  await mkdir(claudeWorkspaceHome, { recursive: true })
  await assertInstallerSymlinkRejected({
    label: 'Claude workspace .claude guard',
    installer: claudeInstaller,
    args: ['--project'],
    cwd: claudeWorkspace,
    env: {
      HOME: claudeWorkspaceHome,
      CLAUDE_CONFIG_DIR: '',
      NAVGATOR_WORKSPACE_ROOT: claudeWorkspace,
      NAVGATOR_PACKAGE_SOURCE: packageDir,
    },
    linkPath: path.join(claudeWorkspace, '.claude'),
    victimPath: path.join(guardRoot, 'victim-workspace-claude'),
  })

  note('installer destination symlink guards passed for user and workspace scopes')
}

async function probeClaude(packageDir, tempRoot, expectedVersion) {
  if (!commandAvailable('claude')) {
    assert.notEqual(process.env.REQUIRE_CLAUDE_VALIDATION, '1', 'Claude CLI is required')
    note('Claude CLI unavailable; structural Claude checks passed, lifecycle skipped')
    return
  }

  const home = path.join(tempRoot, 'claude-home')
  const claudeConfig = path.join(home, '.claude')
  await mkdir(claudeConfig, { recursive: true })
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: claudeConfig,
    DISABLE_AUTOUPDATER: '1',
    NAVGATOR_PACKAGE_SOURCE: packageDir,
  }
  const installer = path.join(packageDir, 'scripts', 'install-plugin.sh')
  const options = { cwd: packageDir, env, timeout: 180_000 }

  // No --strict here: NavGator is a git-sourced auto-SHA plugin whose
  // manifest deliberately omits `version` (99961eb), and --strict promotes
  // the CLI's resulting "no version specified" warning to a hard error, so
  // strict mode is unsatisfiable here by construction. Non-strict validation
  // still runs and still fails closed on real structural problems.
  run('claude', ['plugin', 'validate', packageDir], options)
  run('bash', [installer, '--global'], options)
  run('bash', [installer, '--global'], options)

  const plugins = JSON.parse(run('claude', ['plugin', 'list', '--json'], options))
  const matches = plugins.filter(
    (plugin) => plugin.id === 'navgator@navgator' && plugin.scope === 'user',
  )
  assert.equal(matches.length, 1, 'Claude installer is idempotent')
  const plugin = matches[0]
  // No equality assertion against `plugin.version` here: the manifest
  // deliberately omits version (99961eb), so Claude resolves it itself —
  // `"unknown"` for a local-path source (this probe), the commit SHA for a
  // git source. That host-resolved string is not NavGator's identity oracle;
  // `installedCliVersion` below is.
  assert.equal(plugin.enabled, true, 'Claude marks navgator enabled')
  assert.ok(plugin.installPath, 'Claude reports an install path')
  await access(path.join(plugin.installPath, 'node_modules', 'glob', 'package.json'))

  // Default install: Claude copies the marketplace source into its plugin
  // cache, so a `.mcp.json` in the cache is exactly what a default MCP
  // registration would look like. Its absence is the assertion.
  await assert.rejects(
    access(path.join(plugin.installPath, '.mcp.json')),
    'default Claude install registers no MCP server',
  )

  // Version identity of the installed runtime used to come from the MCP
  // handshake. The CLI is the surface that now ships by default, so it carries
  // the same property. Because the manifest omits version and the host's own
  // `plugin.version` report is therefore just "unknown" for this local-path
  // install, this is now the SOLE runtime-identity oracle for the Claude
  // lifecycle: it proves the installed package tree is actually running
  // NavGator's code at the expected package.json version, independent of
  // whatever string the host chooses to report.
  const installedCliVersion = run(
    'node',
    [path.join(plugin.installPath, 'dist', 'cli', 'index.js'), '--version'],
    { cwd: plugin.installPath, env, timeout: 60_000 },
  )
  assert.equal(installedCliVersion, expectedVersion, 'installed Claude CLI version matches package')

  // Same-version refresh replaces the guard-validated package directory. A
  // planted MCP leaf symlink is removed as an entry and never followed.
  const claudePackageDir = path.join(
    claudeConfig,
    'navgator-runtime',
    'node_modules',
    '@tyroneross',
    'navgator',
  )
  const claudeMcpLink = path.join(claudePackageDir, '.mcp.json')
  const claudeMcpVictim = path.join(tempRoot, 'victim-claude-mcp.json')
  await writeFile(claudeMcpVictim, 'Claude MCP victim: unchanged\n')
  await symlink(claudeMcpVictim, claudeMcpLink, 'file')
  run('bash', [installer, '--global', '--with-mcp'], {
    cwd: packageDir,
    env,
    timeout: 300_000,
  })
  assert.equal(await readFile(claudeMcpVictim, 'utf8'), 'Claude MCP victim: unchanged\n')
  assert.equal((await lstat(claudeMcpLink)).isSymbolicLink(), false, 'fresh Claude MCP config replaces the stale symlink entry')
  await rm(claudeMcpLink, { force: true })
}

class AppServerClient {
  constructor(command, env) {
    this.child = spawn(command, ['app-server', '--listen', 'stdio://'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.stderr = ''
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk })
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk
      let newline
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line)
        if (message.id !== undefined && this.pending.has(message.id)) {
          const { resolve, reject, timer } = this.pending.get(message.id)
          clearTimeout(timer)
          this.pending.delete(message.id)
          if (message.error) reject(new Error(JSON.stringify(message.error)))
          else resolve(message.result)
        }
      }
    })
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out; stderr: ${this.stderr}`))
      }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  close() {
    this.child.stdin.end()
    this.child.kill('SIGTERM')
  }
}

function findPluginAt(listResult, marketplacePath) {
  const canonical = (value) => {
    try {
      return realpathSync(value)
    } catch {
      return path.resolve(value)
    }
  }
  const marketplace = (listResult.marketplaces ?? [])
    .find((candidate) => canonical(candidate.path) === canonical(marketplacePath))
  const plugin = marketplace?.plugins?.find((candidate) => candidate.name === 'navgator')
  return marketplace && plugin ? { marketplace, plugin } : null
}

async function probeCodex(packageDir, tempRoot, expectedVersion) {
  if (!commandAvailable('codex')) {
    assert.notEqual(process.env.REQUIRE_CODEX_VALIDATION, '1', 'Codex CLI is required')
    note('Codex CLI unavailable; structural Codex checks passed, runtime discovery skipped')
    return
  }

  const workspace = path.join(tempRoot, 'codex-workspace')
  const userHome = path.join(tempRoot, 'codex-user-home')
  const userCodexHome = path.join(userHome, '.codex')
  const workspaceHome = path.join(tempRoot, 'codex-workspace-home')
  const workspaceCodexHome = path.join(workspaceHome, '.codex')
  // The last cache segment is the host's reference for the source, NOT a
  // version we choose. Codex 0.130.0 names it `local` for the
  // `{"source":"local"}` entry the installer registers, and reports `local` in
  // `codex plugin list`'s VERSION column — the same rule as the auto-SHA
  // policy (absent a manifest version, the host substitutes its own reference:
  // a commit SHA for a git source, `local` here). Using package.json's semver
  // instead points every assertion below at `.../0.9.1`, a directory Codex
  // never creates. Keep this in step with CODEX_CACHE_REF in
  // scripts/install-codex-plugin.sh.
  const codexCacheRef = 'local'
  const userCacheDir = path.join(
    userCodexHome,
    'plugins',
    'cache',
    'navgator',
    'navgator',
    codexCacheRef,
  )
  const workspaceCacheDir = path.join(
    workspaceCodexHome,
    'plugins',
    'cache',
    'navgator',
    'navgator',
    codexCacheRef,
  )
  await mkdir(workspace, { recursive: true })
  await mkdir(userCodexHome, { recursive: true })
  await mkdir(workspaceCodexHome, { recursive: true })
  const architectureDir = path.join(workspace, '.navgator', 'architecture')
  await mkdir(architectureDir, { recursive: true })
  await writeFile(path.join(architectureDir, 'index.json'), JSON.stringify({
    schema_version: '1.0.0',
    version: '1.0.0',
    last_scan: Date.now(),
    last_full_scan: Date.now(),
    incrementals_since_full: 0,
    stable_id_scheme: 2,
    project_path: realpathSync(workspace),
    components: { by_name: {}, by_type: {}, by_layer: {}, by_status: {} },
    connections: { by_type: {}, by_from: {}, by_to: {} },
    stats: {
      total_components: 4242,
      total_connections: 17,
      components_by_type: { codex_workspace_marker: 4242 },
      connections_by_type: { codex_workspace_marker: 17 },
      outdated_count: 0,
      vulnerable_count: 0,
    },
  }))
  const commonEnv = {
    ...process.env,
    NAVGATOR_WORKSPACE_ROOT: workspace,
    NAVGATOR_PACKAGE_SOURCE: packageDir,
  }
  const userEnv = {
    ...commonEnv,
    HOME: userHome,
    CODEX_HOME: userCodexHome,
  }
  const workspaceEnv = {
    ...commonEnv,
    HOME: workspaceHome,
    CODEX_HOME: workspaceCodexHome,
  }

  // Two full Codex installs already cost the bulk of this probe on a 2-core
  // runner, so they cover the two modes instead of adding a third:
  //   user scope      -> DEFAULT install, asserts zero MCP registration
  //   workspace scope -> `--with-mcp`, asserts the opt-in path still works
  const installer = path.join(packageDir, 'scripts', 'install-codex-plugin.sh')
  const userInstallOptions = {
    cwd: workspace,
    env: userEnv,
  }
  run('bash', [installer, '--user'], userInstallOptions)
  run('bash', [installer, '--user'], userInstallOptions)
  const userMarketplacePath = path.join(userHome, '.agents', 'plugins', 'marketplace.json')
  await access(userMarketplacePath)
  const userMarketplace = await readJson(userMarketplacePath)
  assert.equal(
    userMarketplace.plugins.filter((plugin) => plugin.name === 'navgator').length,
    1,
    'Codex user installer is idempotent',
  )
  const userEntry = userMarketplace.plugins.find((plugin) => plugin.name === 'navgator')
  assert.ok(userEntry?.source?.path, 'Codex user marketplace has a concrete local source')
  const userPackageDir = path.resolve(userHome, userEntry.source.path)
  await assertNoDefaultMcp(userPackageDir, 'Codex default user registration')

  const userParams = { cwds: [realpathSync(workspace)] }
  const userClient = new AppServerClient('codex', userEnv)
  try {
    await userClient.request('initialize', {
      clientInfo: { name: 'navgator-release-verifier-user', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    })
    const before = await userClient.request('plugin/list', userParams)
    assert.deepEqual(before.marketplaceLoadErrors, [], 'Codex user marketplace loads without errors')
    assert.ok(
      findPluginAt(before, userMarketplacePath),
      'Codex plugin/list discovers the default user registration',
    )

    const read = await userClient.request('plugin/read', {
      pluginName: 'navgator',
      marketplacePath: userMarketplacePath,
    })
    assert.equal(read.plugin.skills.length, 6, 'Codex discovers 6 skills')
    assert.deepEqual(read.plugin.mcpServers, [], 'default Codex install registers no MCP server')
    assert.equal(read.plugin.hooks.length, 0, 'Codex hooks remain empty')

    await userClient.request('plugin/install', {
      pluginName: 'navgator',
      marketplacePath: userMarketplacePath,
    })
  } finally {
    userClient.close()
  }

  // A new app-server process models the new task/session required for plugin
  // skills and MCP configuration to enter the host context.
  const freshClient = new AppServerClient('codex', userEnv)
  try {
    await freshClient.request('initialize', {
      clientInfo: { name: 'navgator-release-verifier-fresh-task', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    })
    const after = await freshClient.request('plugin/list', userParams)
    const installed = findPluginAt(after, userMarketplacePath)?.plugin
    assert.equal(installed?.installed, true, 'Codex marks user navgator installed in a fresh task')
    assert.equal(installed?.enabled, true, 'Codex marks user navgator enabled in a fresh task')
    const freshRead = await freshClient.request('plugin/read', {
      pluginName: 'navgator',
      marketplacePath: userMarketplacePath,
    })
    assert.equal(freshRead.plugin.skills.length, 6, 'fresh Codex task discovers 6 skills')
    assert.deepEqual(freshRead.plugin.mcpServers, [], 'fresh default Codex task registers no MCP server')
    const skills = await freshClient.request('skills/list', {
      cwds: [realpathSync(workspace)],
      forceReload: true,
    })
    assertCodexSkillsFromCache(skills, userCacheDir, workspace, 'fresh Codex user task')
  } finally {
    freshClient.close()
  }

  await access(path.join(userCacheDir, '.codex-plugin', 'plugin.json'))
  await assertNoDefaultMcp(userCacheDir, 'Codex installed default user cache')

  // Runtime-identity oracle, mirroring the Claude lifecycle. The host's own
  // version string is `local` here and cannot prove which build landed, so the
  // installed CLI reporting package.json's semver is what ties the cache to the
  // package we built. Without it the Codex half has no identity check at all.
  assert.equal(
    run('node', [path.join(userCacheDir, 'dist', 'cli', 'index.js'), '--version'], {
      cwd: userCacheDir,
      env: userEnv,
      timeout: 60_000,
    }),
    expectedVersion,
    'installed Codex CLI version matches package',
  )

  // The load-bearing property, carried over from the MCP `status` probe: the
  // installed runtime executes FROM THE CACHE while analyzing the ACTIVE TASK
  // WORKSPACE. 4242/17 exist only in the workspace fixture, so reading them
  // back proves the cache never resolved its own package root as the project.
  const userCacheStatus = probeCliStatus(userCacheDir, workspace, 'Codex installed user cache')
  assert.equal(
    userCacheStatus.stats.total_components,
    4242,
    'installed user cache CLI reads the task workspace',
  )
  assert.equal(
    userCacheStatus.stats.total_connections,
    17,
    'installed user cache CLI keeps package and task roots separate',
  )

  // The registration source is mutable; the cache must not execute it. The CLI
  // is the default runtime now, so it is the entrypoint worth poisoning.
  await writeFile(
    path.join(userPackageDir, 'dist', 'cli', 'index.js'),
    'throw new Error("mutable source runtime must not execute")\n',
  )
  assert.equal(
    probeCliStatus(
      userCacheDir,
      workspace,
      'Codex installed user cache after source mutation',
    ).stats.total_components,
    4242,
    'installed user cache does not execute the mutable registration source',
  )
  await rm(path.join(userHome, '.codex', 'plugins', 'navgator-runtime'), {
    recursive: true,
    force: true,
  })
  const userCacheWorkspace = path.join(tempRoot, 'codex-user-cache-workspace')
  await mkdir(userCacheWorkspace, { recursive: true })
  await writeFile(path.join(userCacheWorkspace, 'package.json'), JSON.stringify({
    name: 'codex-user-cache-workspace',
    version: '1.0.0',
  }))
  const userCacheScan = probeCliScan(
    userCacheDir,
    userCacheWorkspace,
    'Codex installed user cache after source removal',
  )
  assert.ok(
    ['completed', 'noop'].includes(userCacheScan.status),
    'installed user cache scans after source removal',
  )
  const userCacheIndex = await readJson(path.join(userCacheWorkspace, '.navgator', 'architecture', 'index.json'))
  assert.equal(
    realpathSync(userCacheIndex.project_path),
    realpathSync(userCacheWorkspace),
    'installed user cache scans the active task workspace',
  )

  const workspaceInstallOptions = {
    cwd: workspace,
    env: workspaceEnv,
  }
  // Opt-in path. `--with-mcp` is position-independent; passing it after the
  // scope flag also exercises that.
  run('bash', [installer, '--workspace', '--with-mcp'], workspaceInstallOptions)
  run('bash', [installer, '--workspace', '--with-mcp'], workspaceInstallOptions)
  const workspaceMarketplacePath = path.join(workspace, '.agents', 'plugins', 'marketplace.json')
  await access(workspaceMarketplacePath)
  const workspaceMarketplace = await readJson(workspaceMarketplacePath)
  assert.equal(
    workspaceMarketplace.plugins.filter((plugin) => plugin.name === 'navgator').length,
    1,
    'Codex workspace installer is idempotent',
  )
  const workspaceEntry = workspaceMarketplace.plugins.find((plugin) => plugin.name === 'navgator')
  assert.ok(workspaceEntry?.source?.path, 'Codex workspace marketplace has a concrete local source')
  const workspacePackageDir = path.resolve(workspace, workspaceEntry.source.path)
  assertMaterializedCodexMcp(
    workspacePackageDir,
    'Codex workspace registration',
    workspaceCacheDir,
  )

  const workspaceParams = { cwds: [realpathSync(workspace)] }
  const workspaceClient = new AppServerClient('codex', workspaceEnv)
  try {
    await workspaceClient.request('initialize', {
      clientInfo: { name: 'navgator-release-verifier-workspace', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    })
    const listed = await workspaceClient.request('plugin/list', workspaceParams)
    assert.deepEqual(listed.marketplaceLoadErrors, [], 'Codex workspace marketplace loads without errors')
    assert.ok(
      findPluginAt(listed, workspaceMarketplacePath),
      'Codex plugin/list discovers the workspace registration',
    )
    const read = await workspaceClient.request('plugin/read', {
      pluginName: 'navgator',
      marketplacePath: workspaceMarketplacePath,
    })
    assert.equal(read.plugin.skills.length, 6, 'Codex workspace registration discovers 6 skills')
    assert.deepEqual(
      read.plugin.mcpServers,
      ['navgator'],
      'Codex workspace registration discovers MCP under --with-mcp',
    )
    await workspaceClient.request('plugin/install', {
      pluginName: 'navgator',
      marketplacePath: workspaceMarketplacePath,
    })
  } finally {
    workspaceClient.close()
  }

  const freshWorkspaceClient = new AppServerClient('codex', workspaceEnv)
  try {
    await freshWorkspaceClient.request('initialize', {
      clientInfo: { name: 'navgator-release-verifier-workspace-fresh-task', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    })
    const after = await freshWorkspaceClient.request('plugin/list', workspaceParams)
    const installed = findPluginAt(after, workspaceMarketplacePath)?.plugin
    assert.equal(installed?.installed, true, 'Codex marks workspace navgator installed in a fresh task')
    assert.equal(installed?.enabled, true, 'Codex marks workspace navgator enabled in a fresh task')
    const read = await freshWorkspaceClient.request('plugin/read', {
      pluginName: 'navgator',
      marketplacePath: workspaceMarketplacePath,
    })
    assert.equal(read.plugin.skills.length, 6, 'fresh workspace task discovers 6 skills')
    assert.deepEqual(
      read.plugin.mcpServers,
      ['navgator'],
      'fresh workspace task discovers MCP under --with-mcp',
    )
    const skills = await freshWorkspaceClient.request('skills/list', {
      cwds: [realpathSync(workspace)],
      forceReload: true,
    })
    assertCodexSkillsFromCache(skills, workspaceCacheDir, workspace, 'fresh Codex workspace task')
  } finally {
    freshWorkspaceClient.close()
  }

  await access(path.join(workspaceCacheDir, '.codex-plugin', 'plugin.json'))
  const workspaceCacheMcpConfig = assertMaterializedCodexMcp(
    workspaceCacheDir,
    'Codex installed workspace cache',
  )
  const workspaceCacheStatus = probeMcpTool(
    workspaceCacheDir,
    workspaceCacheMcpConfig,
    'Codex installed workspace cache',
    workspace,
    'status',
  )
  assert.match(workspaceCacheStatus, /Components: 4242/, 'installed workspace cache MCP reads the task workspace')
  assert.match(workspaceCacheStatus, /Connections: 17/, 'installed workspace cache MCP keeps package and task roots separate')

  // A same-version refresh now replaces the entire guard-validated package
  // directory before materialization. A planted MCP leaf symlink is therefore
  // removed as an entry, never followed, and the fresh config replaces it.
  const codexMcpLink = path.join(workspacePackageDir, '.codex-plugin', 'mcp.json')
  const codexMcpVictim = path.join(tempRoot, 'victim-codex-mcp.json')
  await rm(codexMcpLink, { force: true })
  await writeFile(codexMcpVictim, 'Codex MCP victim: unchanged\n')
  await symlink(codexMcpVictim, codexMcpLink, 'file')
  run('bash', [installer, '--workspace', '--with-mcp'], {
    cwd: workspace,
    env: workspaceEnv,
    timeout: 300_000,
  })
  assert.equal(await readFile(codexMcpVictim, 'utf8'), 'Codex MCP victim: unchanged\n')
  assert.equal((await lstat(codexMcpLink)).isSymbolicLink(), false, 'fresh MCP config replaces the stale symlink entry')

  await writeFile(
    path.join(workspacePackageDir, 'dist', 'mcp', 'server.js'),
    'throw new Error("mutable source runtime must not execute")\n',
  )
  await rm(path.join(workspace, '.codex', 'plugins', 'navgator-runtime'), {
    recursive: true,
    force: true,
  })
  const workspaceCacheWorkspace = path.join(tempRoot, 'codex-workspace-cache-workspace')
  await mkdir(workspaceCacheWorkspace, { recursive: true })
  await writeFile(path.join(workspaceCacheWorkspace, 'package.json'), JSON.stringify({
    name: 'codex-workspace-cache-workspace',
    version: '1.0.0',
  }))
  const workspaceCacheScan = probeMcpTool(
    workspaceCacheDir,
    workspaceCacheMcpConfig,
    'Codex installed workspace cache after source removal',
    workspaceCacheWorkspace,
    'scan',
    { quick: true },
  )
  assert.match(workspaceCacheScan, /Scan (?:complete|no changes):/, 'installed workspace cache scans after source removal')
  const workspaceCacheIndex = await readJson(path.join(workspaceCacheWorkspace, '.navgator', 'architecture', 'index.json'))
  assert.equal(
    realpathSync(workspaceCacheIndex.project_path),
    realpathSync(workspaceCacheWorkspace),
    'installed workspace cache scans the active task workspace',
  )

  // Closure for the one-way-door defect: opting in must be reversible. A third
  // run WITHOUT the flag has to undo both writes --with-mcp made. Reinstalling
  // the same version restores no mutated manifest and prunes no extraneous
  // file, and the versioned cache above still carries the registration Codex
  // installed from the opt-in source — so only the installer's default branch
  // can revoke it. The cache assertion is the one that fails on the unfixed
  // installer, which did nothing at all without the flag.
  run('bash', [installer, '--workspace'], { ...workspaceInstallOptions, timeout: 300_000 })
  await assertNoDefaultMcp(workspacePackageDir, 'Codex workspace registration after opt-out')
  await assertNoDefaultMcp(workspaceCacheDir, 'Codex installed workspace cache after opt-out')

  const optOutClient = new AppServerClient('codex', workspaceEnv)
  try {
    await optOutClient.request('initialize', {
      clientInfo: { name: 'navgator-release-verifier-workspace-opt-out', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    })
    const read = await optOutClient.request('plugin/read', {
      pluginName: 'navgator',
      marketplacePath: workspaceMarketplacePath,
    })
    assert.deepEqual(read.plugin.mcpServers, [], 'Codex opt-out re-run deregisters the MCP server')
    assert.equal(read.plugin.skills.length, 6, 'Codex opt-out re-run keeps the six skills')
  } finally {
    optOutClient.close()
  }
}

async function main() {
  const packageJson = await readJson(path.join(repoRoot, 'package.json'))
  // Canonicalize immediately: os.tmpdir() is /var/folders/... on macOS, a
  // symlink to /private/var/.... The codex app-server reports realpath'd
  // marketplace paths, so building every path from the realpath'd root keeps
  // string comparisons stable even when a transient clone rewrite makes a
  // later realpathSync() fall back to the unresolved path.
  const tempRoot = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'navgator-release-')))
  // Isolate every MCP probe's home before any of them run — see setMcpProbeHome.
  const mcpHome = path.join(tempRoot, 'mcp-probe-home')
  await mkdir(mcpHome, { recursive: true })
  setMcpProbeHome(mcpHome)
  let tarballPath
  let removeTarball = false

  try {
    let files
    if (process.env.NAVGATOR_RELEASE_TARBALL) {
      tarballPath = path.resolve(repoRoot, process.env.NAVGATOR_RELEASE_TARBALL)
      await access(tarballPath)
      files = run('tar', ['-tf', tarballPath])
        .split(/\r?\n/)
        .filter(Boolean)
        .map((entry) => entry.replace(/^\.\/package\//, '').replace(/^package\//, ''))
      note(`verifying pre-existing release artifact ${path.basename(tarballPath)}`)
    } else {
      const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts']))
      assert.equal(packed.length, 1, 'npm pack should produce one artifact')
      tarballPath = path.join(repoRoot, packed[0].filename)
      files = packed[0].files.map((entry) => entry.path)
      removeTarball = true
    }

    assert.equal(countMatching(files, /^commands\/[^/]+\.md$/), 15, 'packed Claude commands')
    assert.equal(countMatching(files, /^agents\/[^/]+\.md$/), 4, 'packed Claude agents')
    assert.equal(countMatching(files, /^skills\/[^/]+\/SKILL\.md$/), 6, 'packed shared skills')
    assert.ok(files.includes('scripts/promote-lessons.py'), 'promote-lessons script is packed')
    assert.ok(files.includes('web/server.cjs'), 'dashboard launcher is packed')
    assert.ok(files.includes('web/runtime/server.cjs'), 'dashboard runtime is packed')
    assert.ok(!files.some((file) => file.startsWith('dist/__tests__/')), 'compiled tests are excluded')
    assert.ok(!files.some((file) => file.split('/').includes('node_modules')), 'npm-stripped node_modules are not relied upon')
    assert.ok(!files.some((file) => file.endsWith('.node')), 'dashboard payload must not embed platform-specific native binaries')

    // Default agent surface is CLI-first: the tarball must carry neither host's
    // auto-loaded MCP config, and must carry both opt-in templates.
    assert.ok(!files.includes('.mcp.json'), 'packed package ships no root .mcp.json')
    assert.ok(!files.includes('.codex-plugin/mcp.json'), 'packed package ships no Codex MCP config')
    assert.ok(files.includes('mcp-optin/claude.mcp.json'), 'Claude MCP opt-in template is packed')
    assert.ok(files.includes('mcp-optin/codex.mcp.json'), 'Codex MCP opt-in template is packed')
    assert.ok(files.includes('mcp-optin/README.md'), 'MCP opt-in README is packed')

    const installRoot = path.join(tempRoot, 'installed')
    await mkdir(installRoot, { recursive: true })
    run('npm', [
      'install',
      '--prefix', installRoot,
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      tarballPath,
    ])
    const packageDir = path.join(installRoot, 'node_modules', '@tyroneross', 'navgator')
    const packedPackage = await readJson(path.join(packageDir, 'package.json'))
    assert.equal(packedPackage.version, packageJson.version, 'packed package version')
    assert.equal(packedPackage.license, packageJson.license, 'packed package license')
    await verifyIdentity(packageDir, packedPackage)
    await verifyDashboardPayload(packageDir)
    await probeInstallerSymlinkGuards(packageDir, tempRoot)

    const cliVersion = run('node', ['dist/cli/index.js', '--version'], { cwd: packageDir })
    assert.equal(cliVersion, packedPackage.version, 'CLI version matches package')
    await assertNoDefaultMcp(packageDir, 'installed package')
    await assertMcpOptInTemplates(packageDir)

    // Opt-in path, proven at no extra install cost: launch the server straight
    // from each host's template. Both still initialize as `navgator`, expose
    // exactly the 12 tools, and report the package version — the same three
    // properties the default-registration probes used to assert.
    const claudeMcpVersion = probeMcp(
      packageDir,
      path.join(packageDir, 'mcp-optin', 'claude.mcp.json'),
      'Claude opt-in',
    )
    const codexMcpVersion = probeMcp(
      packageDir,
      path.join(packageDir, 'mcp-optin', 'codex.mcp.json'),
      'Codex opt-in',
    )
    assert.equal(claudeMcpVersion, packedPackage.version, 'Claude opt-in MCP version matches package')
    assert.equal(codexMcpVersion, packedPackage.version, 'Codex opt-in MCP version matches package')

    await probeClaude(packageDir, tempRoot, packedPackage.version)
    await probeCodex(packageDir, tempRoot, packedPackage.version)
    await probeDashboard(packageDir, tempRoot)
    note(`release contract passed for ${packedPackage.name}@${packedPackage.version}`)
  } finally {
    if (removeTarball && tarballPath) await rm(tarballPath, { force: true })
    // codex clones plugins into <home>/.codex/.tmp/*/.git during plugin/list;
    // a teardown that races those writes can hit ENOTEMPTY. Retry to absorb it.
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
