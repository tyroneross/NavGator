"use client"

import { useEffect } from "react"
import { adoptTokenFromHash } from "@/lib/api-client"

/**
 * Completes the dashboard's session handoff.
 *
 * `web/proxy.ts` redeems the one-time `?nvt=<nonce>` and redirects to
 * `/#t=<sessionToken>`. This component moves that fragment into
 * `sessionStorage` and clears it from the URL on mount, so the token stops
 * being visible in the address bar as early as the first paint.
 *
 * It renders nothing and is deliberately not the ONLY adoption path:
 * `apiFetch` adopts lazily too, because React runs child effects before
 * parent effects and a data hook can fire before a layout-level effect. This
 * component makes the URL scrub prompt; `apiFetch` makes correctness
 * independent of mount order.
 */
export function SessionBootstrap() {
  useEffect(() => {
    adoptTokenFromHash()
  }, [])

  return null
}
