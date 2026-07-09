import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.dirname(fileURLToPath(import.meta.url))
let tracingRoot = webRoot

try {
  const modulesRoot = realpathSync(path.join(webRoot, 'node_modules'))
  if (path.relative(webRoot, modulesRoot).startsWith('..')) {
    tracingRoot = path.resolve(modulesRoot, '..', '..')
  }
} catch {
  // A missing dependency directory will be reported by the build itself.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: tracingRoot,
  turbopack: {
    root: tracingRoot,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }]
  },
}

export default nextConfig
