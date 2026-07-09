#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '..')
const webRoot = path.join(packageRoot, 'web')
const standaloneRoot = path.join(webRoot, '.next', 'standalone')
const runtimeRoot = path.join(webRoot, 'runtime')

async function walk(root) {
  const found = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    found.push({ entry, fullPath })
    if (entry.isDirectory()) found.push(...await walk(fullPath))
  }
  return found
}

async function findStandaloneServer() {
  const direct = path.join(standaloneRoot, 'server.js')
  try {
    await lstat(direct)
    return direct
  } catch {
    // Multi-lockfile and linked-worktree builds can nest the server under the tracing root.
  }

  const candidates = (await walk(standaloneRoot))
    .filter(({ entry }) => entry.isFile() && entry.name === 'server.js')
    .map(({ fullPath }) => fullPath)
    .filter((candidate) => !candidate.split(path.sep).includes('node_modules'))

  for (const candidate of candidates) {
    try {
      await lstat(path.join(path.dirname(candidate), '.next'))
      return candidate
    } catch {
      // Keep looking for the standalone entry with its adjacent .next directory.
    }
  }

  throw new Error('No Next.js standalone server entry was found.')
}

async function findModuleRoots() {
  const candidates = (await walk(standaloneRoot))
    .filter(({ entry }) => entry.name === 'node_modules' && (entry.isDirectory() || entry.isSymbolicLink()))
    .map(({ fullPath }) => fullPath)
    .filter((candidate) => {
      const relative = path.relative(standaloneRoot, candidate)
      return relative.split(path.sep).filter((part) => part === 'node_modules').length === 1
    })

  const concrete = []
  const linked = []
  for (const candidate of candidates) {
    const candidateStat = await lstat(candidate)
    if (candidateStat.isSymbolicLink()) linked.push(candidate)
    else concrete.push(candidate)
  }

  return concrete.length > 0 ? concrete : linked
}

async function assertFlatRuntimeModules(root) {
  const nested = (await walk(root)).find(
    ({ entry }) => entry.isDirectory() && entry.name === 'node_modules',
  )

  if (nested) {
    throw new Error(
      'Next.js emitted nested node_modules. Refusing to create a package that npm would silently strip.',
    )
  }
}

function packagePath(root, name) {
  return path.join(root, ...name.split('/'))
}

async function readPackage(packageDir) {
  return JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
}

async function existingPackageDir(root, name) {
  const candidate = packagePath(root, name)
  try {
    await lstat(path.join(candidate, 'package.json'))
    return candidate
  } catch {
    return null
  }
}

async function resolveDependencyDir(sourceRoot, ownerDir, name) {
  const nested = await existingPackageDir(path.join(ownerDir, 'node_modules'), name)
  if (nested) return nested
  return existingPackageDir(sourceRoot, name)
}

async function copyDependencyClosure(sourceRoot, destinationRoot) {
  const seeds = ['next', 'react', 'react-dom']
  const queue = []
  const seen = new Map()

  for (const name of seeds) {
    const packageDir = await existingPackageDir(sourceRoot, name)
    if (!packageDir) throw new Error(`Standalone dependency ${name} is missing from ${sourceRoot}`)
    queue.push({ name, packageDir })
  }

  while (queue.length > 0) {
    const { name, packageDir } = queue.shift()
    const canonicalDir = await realpath(packageDir)
    const prior = seen.get(name)
    if (prior && prior !== canonicalDir) {
      throw new Error(`Runtime dependency ${name} resolves to multiple package versions.`)
    }
    if (prior) continue
    seen.set(name, canonicalDir)

    const manifest = await readPackage(packageDir)
    const destination = packagePath(destinationRoot, name)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(packageDir, destination, {
      recursive: true,
      dereference: true,
      filter(source) {
        const relative = path.relative(packageDir, source)
        return !relative.split(path.sep).includes('node_modules')
      },
    })

    const required = Object.keys(manifest.dependencies ?? {})
    const optional = Object.keys(manifest.optionalDependencies ?? {})
    const peers = Object.keys(manifest.peerDependencies ?? {})

    for (const dependency of [...new Set([...required, ...optional, ...peers])]) {
      const dependencyDir = await resolveDependencyDir(sourceRoot, packageDir, dependency)
      if (dependencyDir) {
        queue.push({ name: dependency, packageDir: dependencyDir })
      } else if (required.includes(dependency)) {
        throw new Error(`Required runtime dependency ${dependency} for ${name} is missing.`)
      }
    }
  }
}

async function pruneNativeRuntimePackages(root) {
  await Promise.all([
    rm(path.join(root, 'sharp'), { recursive: true, force: true }),
    rm(path.join(root, '@img'), { recursive: true, force: true }),
    rm(path.join(root, 'detect-libc'), { recursive: true, force: true }),
  ])

  const nextScope = path.join(root, '@next')
  try {
    for (const entry of await readdir(nextScope, { withFileTypes: true })) {
      if (entry.name.startsWith('swc-')) {
        await rm(path.join(nextScope, entry.name), { recursive: true, force: true })
      }
    }
  } catch {
    // @next/env is optional in some Next.js output shapes.
  }
}

async function assertPortableRuntime(root) {
  const nativeBinary = (await walk(root)).find(
    ({ entry }) => entry.isFile() && /\.(?:node|dylib|dll|so(?:\.\d+)*)$/.test(entry.name),
  )
  if (nativeBinary) {
    throw new Error(`Platform-specific native binary remained in dashboard runtime: ${nativeBinary.fullPath}`)
  }

  const forbidden = [
    path.join(root, 'sharp'),
    path.join(root, '@img'),
    path.join(root, 'detect-libc'),
  ]
  for (const candidate of forbidden) {
    try {
      await lstat(candidate)
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue
      throw error
    }
    throw new Error(`Platform-specific package remained in dashboard runtime: ${candidate}`)
  }

  try {
    const nativeNextPackage = (await readdir(path.join(root, '@next')))
      .find((name) => name.startsWith('swc-'))
    if (nativeNextPackage) {
      throw new Error(`Platform-specific package remained in dashboard runtime: @next/${nativeNextPackage}`)
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return
    throw error
  }
}

async function assertNoSymlinks(root) {
  const linked = (await walk(root)).find(({ entry }) => entry.isSymbolicLink())
  if (linked) {
    throw new Error(`Symbolic link remained in dashboard runtime: ${linked.fullPath}`)
  }
}

function sanitizeStandaloneConfig(server) {
  const prefix = 'const nextConfig = '
  const suffix = '\n\nprocess.env.__NEXT_PRIVATE_STANDALONE_CONFIG'
  const start = server.indexOf(prefix)
  const end = server.indexOf(suffix, start)
  if (start < 0 || end < 0) {
    throw new Error('Unexpected Next.js standalone config shape; refusing to publish build paths.')
  }

  const configStart = start + prefix.length
  const config = JSON.parse(server.slice(configStart, end))
  config.outputFileTracingRoot = '.'
  if (config.turbopack && typeof config.turbopack === 'object') config.turbopack.root = '.'
  return `${server.slice(0, configStart)}${JSON.stringify(config)}${server.slice(end)}`
}

async function sanitizeRequiredServerFiles(root) {
  const requiredPath = path.join(root, 'required-server-files.json')
  const required = JSON.parse(await readFile(requiredPath, 'utf8'))
  required.appDir = '.'
  if (required.config && typeof required.config === 'object') {
    required.config.outputFileTracingRoot = '.'
    if (required.config.turbopack && typeof required.config.turbopack === 'object') {
      required.config.turbopack.root = '.'
    }
  }
  await writeFile(requiredPath, `${JSON.stringify(required, null, 2)}\n`)
}

async function assertNoLocalBuildPaths(root) {
  const forbidden = [
    packageRoot,
    webRoot,
    os.homedir(),
    '.build-loop/worktrees/',
    '/home/runner/work/',
  ].filter((value, index, values) => value && values.indexOf(value) === index)

  for (const { entry, fullPath } of await walk(root)) {
    if (!entry.isFile()) continue
    const content = await readFile(fullPath)
    for (const marker of forbidden) {
      if (content.includes(Buffer.from(marker))) {
        throw new Error(`Local build path remained in dashboard runtime: ${fullPath}`)
      }
    }
  }
}

async function main() {
  const sourceServer = await findStandaloneServer()
  const sourceNext = path.join(path.dirname(sourceServer), '.next')
  const sourceModuleRoots = await findModuleRoots()
  const server = await readFile(sourceServer, 'utf8').catch(() => null)
  if (!server) {
    throw new Error(
      `Missing ${path.relative(packageRoot, sourceServer)}. Run the web build before preparing the runtime.`,
    )
  }

  if (!server.startsWith("const path = require('path')")) {
    throw new Error('Unexpected Next.js standalone server shape; refusing to patch module resolution.')
  }

  if (sourceModuleRoots.length === 0) {
    throw new Error('Next.js standalone output contains no runtime module roots.')
  }

  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true })

  const moduleBootstrap = [
    "const Module = require('module')",
    "process.env.NODE_PATH = [path.join(__dirname, 'packages'), process.env.NODE_PATH]",
    '  .filter(Boolean)',
    '  .join(path.delimiter)',
    'Module._initPaths()',
  ].join('\n')
  const runtimeServer = sanitizeStandaloneConfig(server.replace(
    "const path = require('path')",
    `const path = require('path')\n${moduleBootstrap}`,
  ))

  await writeFile(path.join(runtimeRoot, 'server.cjs'), runtimeServer)
  const runtimePackages = path.join(runtimeRoot, 'packages')
  for (const sourceModules of sourceModuleRoots) {
    const moduleStat = await lstat(sourceModules)
    if (moduleStat.isSymbolicLink()) {
      await copyDependencyClosure(await realpath(sourceModules), runtimePackages)
    } else {
      await assertFlatRuntimeModules(sourceModules)
      await cp(sourceModules, runtimePackages, { recursive: true, force: true })
    }
  }
  // The dashboard disables image optimization. TypeScript and Sharp's native
  // platform payloads are therefore traced build inputs, not runtime inputs.
  await rm(path.join(runtimePackages, 'typescript'), { recursive: true, force: true })
  await pruneNativeRuntimePackages(runtimePackages)
  await assertFlatRuntimeModules(runtimePackages)
  await assertPortableRuntime(runtimePackages)
  await cp(sourceNext, path.join(runtimeRoot, '.next'), { recursive: true })
  await sanitizeRequiredServerFiles(path.join(runtimeRoot, '.next'))

  const staticDir = path.join(webRoot, '.next', 'static')
  await cp(staticDir, path.join(runtimeRoot, '.next', 'static'), { recursive: true, force: true })

  const publicDir = path.join(webRoot, 'public')
  await cp(publicDir, path.join(runtimeRoot, 'public'), { recursive: true, force: true })
  await assertNoSymlinks(runtimeRoot)
  await assertNoLocalBuildPaths(runtimeRoot)

  await rm(path.join(webRoot, 'server.js'), { force: true })
  await writeFile(
    path.join(webRoot, 'server.cjs'),
    "process.env.HOSTNAME = '127.0.0.1'\nrequire('./runtime/server.cjs')\n",
  )

  process.stdout.write('Prepared package-safe dashboard runtime at web/server.cjs + web/runtime/.\n')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
