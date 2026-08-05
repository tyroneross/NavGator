import React from "react"
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ProjectProvider } from '@/lib/project-context'
import { SessionBootstrap } from '@/components/session-bootstrap'
import './globals.css'

/**
 * `<Analytics />` (@vercel/analytics) was removed here, not disabled.
 *
 * Off Vercel it loads `https://va.vercel-scripts.com/v1/script.debug.js`
 * whenever NODE_ENV !== 'production' — i.e. exactly in the degraded local
 * dev mode — injecting a remote third-party script into the same privileged
 * origin that serves `/api/*`. Anything running in that origin can call
 * those routes same-origin, with the session token the page already holds.
 * Its production URL (`/_vercel/insights/script.js`) 404s on a self-hosted
 * loopback tool, so the component had no working destination here either
 * way. `next.config.mjs` now also sets a `script-src` backstop.
 */

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'NavGator - Architecture Connection Tracker',
  description: 'Know your stack before you change it. Track architecture connections across your entire stack.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans antialiased`}>
        <SessionBootstrap />
        <ProjectProvider>
          {children}
        </ProjectProvider>
      </body>
    </html>
  )
}
