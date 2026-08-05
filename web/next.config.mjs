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

/**
 * `script-src` backstop for the dashboard origin (SEC-006).
 *
 * The only prior CSP directive was `frame-ancestors`, so nothing constrained
 * WHERE script in this origin could come from — and a remote third-party
 * analytics script was in fact being injected here in dev. That component is
 * gone, but removing one offender is not a control; this is. Anything
 * executing in this origin can call `/api/*` same-origin with the session
 * token the page holds, so the origin gets no third-party script at all.
 *
 * `'unsafe-inline'` is required: Next.js emits inline bootstrap and flight
 * payload scripts, and this build does not run the nonce/strict-dynamic
 * pipeline that would let us drop it. `'unsafe-eval'` is added ONLY in
 * development, where Turbopack's HMR runtime needs it — the packed
 * standalone build (the thing `navgator ui` actually serves) does not get it.
 * Verified by building and loading the page, not by reading the docs.
 */
const isDev = process.env.NODE_ENV !== 'production'
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'"
const csp = ["frame-ancestors 'none'", scriptSrc].join('; ')

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
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }]
  },
}

export default nextConfig
