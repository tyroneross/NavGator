#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { request as nodeHttpRequest } from 'node:http'
import { readFileSync, realpathSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const expectedTools = [
  'connections',
  'diagram',
  'explore',
  'impact',
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
  for (const [label, manifest] of [
    ['Claude manifest', claudeManifest],
    ['Claude marketplace entry', claudeEntry],
    ['Codex manifest', codexManifest],
  ]) {
    assert.equal(manifest.name, 'navgator', `${label} name`)
    assert.equal(manifest.version, packageJson.version, `${label} version`)
    assert.equal(manifest.license, packageJson.license, `${label} license`)
  }

  const hooks = await readJson(path.join(packageDir, 'hooks', 'hooks.json'))
  assert.deepEqual(hooks, { hooks: {} }, 'hooks must remain empty')
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
  const output = run(server.command, args, { cwd, input, timeout: 10_000 })
  const responses = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  const initialized = responses.find((response) => response.id === 1)
  const listed = responses.find((response) => response.id === 2)

  assert.equal(initialized?.result?.serverInfo?.name, 'navgator', `${host} MCP initialized`)
  const tools = listed?.result?.tools?.map((tool) => tool.name).sort()
  assert.deepEqual(tools, expectedTools, `${host} MCP exposes the expected 10 tools`)
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
  })
  const responses = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  const called = responses.find((response) => response.id === 3)
  assert.ok(called?.result, `${host} MCP ${name} returned a result`)
  assert.equal(called.result.isError, undefined, `${host} MCP ${name} did not return an error`)
  return called.result.content?.map((item) => item.text ?? '').join('\n') ?? ''
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
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
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
          assert.match(
            response.headers.get('content-security-policy') ?? '',
            /frame-ancestors 'none'/,
            'packed dashboard denies framing with CSP',
          )
          assert.equal(response.headers.get('x-frame-options'), 'DENY', 'packed dashboard denies framing')
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
            signal: AbortSignal.timeout(2_000),
          })
          assert.equal(scanHealth.status, 200, 'packed dashboard scan health returns HTTP 200')
          const scanHealthPayload = await scanHealth.json()
          assert.equal(scanHealthPayload.available, true, 'packed dashboard resolves its packaged CLI entry')
          assert.equal(scanHealthPayload.version, expectedVersion, 'packed dashboard executes the packaged CLI version')

          const scanResponse = await fetch(`http://127.0.0.1:${port}/api/scan`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: `http://127.0.0.1:${port}`,
              'sec-fetch-site': 'same-origin',
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
            { signal: AbortSignal.timeout(2_000) },
          )
          assert.equal(clampedSubgraph.status, 200, 'bounded subgraph accepts clamped integer inputs')
          const clampedSubgraphPayload = await clampedSubgraph.json()
          assert.equal(clampedSubgraphPayload.data.stats.nodes, 1, 'subgraph clamps depth and maxNodes safely')

          const stressUrl = new URL(`http://127.0.0.1:${port}/api/trace`)
          stressUrl.searchParams.set('component', 'Stress0')
          stressUrl.searchParams.set('maxDepth', '10')
          stressUrl.searchParams.set('maxPaths', '10')
          stressUrl.searchParams.set('path', traceStressProject)
          const stressResponse = await fetch(stressUrl, { signal: AbortSignal.timeout(3_000) })
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
          const denseSubgraph = await fetch(denseSubgraphUrl, { signal: AbortSignal.timeout(3_000) })
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

  const output = runExpectFailure('bash', [installer, ...args], { cwd, env })
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

  run('claude', ['plugin', 'validate', packageDir, '--strict'], options)
  run('bash', [installer, '--global'], options)
  run('bash', [installer, '--global'], options)

  const plugins = JSON.parse(run('claude', ['plugin', 'list', '--json'], options))
  const matches = plugins.filter(
    (plugin) => plugin.id === 'navgator@navgator' && plugin.scope === 'user',
  )
  assert.equal(matches.length, 1, 'Claude installer is idempotent')
  const plugin = matches[0]
  assert.equal(plugin.version, expectedVersion, 'Claude installed version matches package')
  assert.equal(plugin.enabled, true, 'Claude marks navgator enabled')
  assert.ok(plugin.installPath, 'Claude reports an install path')
  await access(path.join(plugin.installPath, 'node_modules', 'glob', 'package.json'))

  const mcpVersion = probeMcp(
    plugin.installPath,
    path.join(plugin.installPath, '.mcp.json'),
    'installed Claude plugin',
  )
  assert.equal(mcpVersion, expectedVersion, 'installed Claude MCP version matches package')
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
  const userCacheDir = path.join(
    userCodexHome,
    'plugins',
    'cache',
    'navgator',
    'navgator',
    expectedVersion,
  )
  const workspaceCacheDir = path.join(
    workspaceCodexHome,
    'plugins',
    'cache',
    'navgator',
    'navgator',
    expectedVersion,
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
  assertMaterializedCodexMcp(
    userPackageDir,
    'Codex user registration',
    userCacheDir,
  )

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
    assert.deepEqual(read.plugin.mcpServers, ['navgator'], 'Codex discovers NavGator MCP')
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
    assert.deepEqual(freshRead.plugin.mcpServers, ['navgator'], 'fresh Codex task discovers MCP')
    const skills = await freshClient.request('skills/list', {
      cwds: [realpathSync(workspace)],
      forceReload: true,
    })
    assertCodexSkillsFromCache(skills, userCacheDir, workspace, 'fresh Codex user task')
  } finally {
    freshClient.close()
  }

  await access(path.join(userCacheDir, '.codex-plugin', 'plugin.json'))
  const userCacheMcpConfig = assertMaterializedCodexMcp(
    userCacheDir,
    'Codex installed user cache',
  )
  const userCacheStatus = probeMcpTool(
    userCacheDir,
    userCacheMcpConfig,
    'Codex installed user cache',
    workspace,
    'status',
  )
  assert.match(userCacheStatus, /Components: 4242/, 'installed user cache MCP reads the task workspace')
  assert.match(userCacheStatus, /Connections: 17/, 'installed user cache MCP keeps package and task roots separate')

  await writeFile(
    path.join(userPackageDir, 'dist', 'mcp', 'server.js'),
    'throw new Error("mutable source runtime must not execute")\n',
  )
  assert.match(
    probeMcpTool(
      userCacheDir,
      userCacheMcpConfig,
      'Codex installed user cache after source mutation',
      workspace,
      'status',
    ),
    /Components: 4242/,
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
  const userCacheScan = probeMcpTool(
    userCacheDir,
    userCacheMcpConfig,
    'Codex installed user cache after source removal',
    userCacheWorkspace,
    'scan',
    { quick: true },
  )
  assert.match(userCacheScan, /Scan (?:complete|no changes):/, 'installed user cache scans after source removal')
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
  run('bash', [installer, '--workspace'], workspaceInstallOptions)
  run('bash', [installer, '--workspace'], workspaceInstallOptions)
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
    assert.deepEqual(read.plugin.mcpServers, ['navgator'], 'Codex workspace registration discovers MCP')
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
    assert.deepEqual(read.plugin.mcpServers, ['navgator'], 'fresh workspace task discovers MCP')
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
}

async function main() {
  const packageJson = await readJson(path.join(repoRoot, 'package.json'))
  // Canonicalize immediately: os.tmpdir() is /var/folders/... on macOS, a
  // symlink to /private/var/.... The codex app-server reports realpath'd
  // marketplace paths, so building every path from the realpath'd root keeps
  // string comparisons stable even when a transient clone rewrite makes a
  // later realpathSync() fall back to the unresolved path.
  const tempRoot = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'navgator-release-')))
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

    assert.equal(countMatching(files, /^commands\/[^/]+\.md$/), 13, 'packed Claude commands')
    assert.equal(countMatching(files, /^agents\/[^/]+\.md$/), 4, 'packed Claude agents')
    assert.equal(countMatching(files, /^skills\/[^/]+\/SKILL\.md$/), 6, 'packed shared skills')
    assert.ok(files.includes('scripts/promote-lessons.py'), 'promote-lessons script is packed')
    assert.ok(files.includes('web/server.cjs'), 'dashboard launcher is packed')
    assert.ok(files.includes('web/runtime/server.cjs'), 'dashboard runtime is packed')
    assert.ok(!files.some((file) => file.startsWith('dist/__tests__/')), 'compiled tests are excluded')
    assert.ok(!files.some((file) => file.split('/').includes('node_modules')), 'npm-stripped node_modules are not relied upon')
    assert.ok(!files.some((file) => file.endsWith('.node')), 'dashboard payload must not embed platform-specific native binaries')

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
    const claudeMcpVersion = probeMcp(packageDir, path.join(packageDir, '.mcp.json'), 'Claude')
    const codexMcpVersion = probeMcp(packageDir, path.join(packageDir, '.codex-plugin', 'mcp.json'), 'Codex')
    assert.equal(claudeMcpVersion, packedPackage.version, 'Claude MCP version matches package')
    assert.equal(codexMcpVersion, packedPackage.version, 'Codex MCP version matches package')

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
