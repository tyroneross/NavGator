import { NextRequest, NextResponse } from "next/server";

export function isDashboardHostnameAllowed(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function getDashboardRequestHostname(request: NextRequest): string {
  const host = request.headers.get("host");
  if (host) {
    try {
      return new URL(`http://${host}`).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
  return request.nextUrl.hostname.toLowerCase();
}

/**
 * Reject any dashboard request (GET or mutation) whose Host header does not
 * resolve to a loopback hostname. Extracted out of rejectUnsafeMutation so
 * read-only routes that accept attacker-influenced query params (e.g.
 * /api/coverage's `path`) can enforce the same loopback boundary that
 * cross-origin same-origin-policy alone does not provide for simple GETs
 * (no preflight, so DNS rebinding can still reach the handler).
 */
export function rejectNonLoopback(request: NextRequest): NextResponse | null {
  if (!isDashboardHostnameAllowed(getDashboardRequestHostname(request))) {
    return NextResponse.json(
      { success: false, error: "Dashboard requests must use a loopback hostname" },
      { status: 403 },
    );
  }
  return null;
}

/**
 * A request header name used by dashboard-session.ts / proxy.ts to carry
 * the per-launch capability token for non-browser local clients (a script
 * that can read the 0600 session file). `rejectUnsafeMutation` only checks
 * for its PRESENCE, never its value — proxy.ts runs before every route on
 * the single dashboard choke point (`web/proxy.ts`'s matcher covers
 * `/api/:path*`) and has already rejected the request with 401 if the
 * header's value did not match the real token. By the time a route handler
 * (and therefore this guard) runs, a present `x-navgator-token` header is
 * known-valid. Presence-checking here would be unsound in isolation; it is
 * sound only because of that ordering, which is why this comment exists —
 * don't let this function be called anywhere the proxy hasn't already run.
 */
const DASHBOARD_TOKEN_HEADER = "x-navgator-token";

export function rejectUnsafeMutation(request: NextRequest): NextResponse | null {
  const nonLoopback = rejectNonLoopback(request);
  if (nonLoopback) return nonLoopback;
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json(
      { success: false, error: "Mutation requests require application/json" },
      { status: 415 },
    );
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return NextResponse.json(
      { success: false, error: "Cross-site mutation request rejected" },
      { status: 403 },
    );
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    // A missing Origin used to be a free pass — that let any non-browser
    // local client (which never sends Origin) skip this check entirely.
    // Now it's only a pass when the request already carries the dashboard
    // token header; see the ordering-dependency comment on
    // DASHBOARD_TOKEN_HEADER above for why presence alone is sufficient.
    // `.get()` rather than `.has()` deliberately — every other check in
    // this file reads headers via `.get()`, and this keeps
    // rejectUnsafeMutation callable with any headers object that only
    // implements `.get()` (NextRequest's real Headers implements both).
    if (request.headers.get(DASHBOARD_TOKEN_HEADER)) return null;
    return NextResponse.json(
      { success: false, error: "Mutation requests without an Origin header require a dashboard session token" },
      { status: 403 },
    );
  }
  try {
    const originUrl = new URL(origin);
    const requestHost = request.headers.get("host")?.toLowerCase() || request.nextUrl.host.toLowerCase();
    if (
      originUrl.protocol !== request.nextUrl.protocol ||
      originUrl.host.toLowerCase() !== requestHost
    ) {
      return NextResponse.json(
        { success: false, error: "Cross-origin mutation request rejected" },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid mutation origin" },
      { status: 403 },
    );
  }
  return null;
}
