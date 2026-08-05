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
 * Proof that `web/proxy.ts` validated this request's session token.
 *
 * This replaces a presence-check on the client-supplied `x-navgator-token`.
 * That check was unsound and was reproduced failing: with the token env
 * unset the proxy degraded to pass-through, and a
 * `POST /api/registry-health` carrying `x-navgator-token: totally-fake` and
 * no `Origin` reached the handler (400), while the same request WITHOUT the
 * header was correctly rejected (403). Supplying a garbage header made the
 * request more privileged, because the guard was reading a value the client
 * controls and a comment was standing in for the control.
 *
 * `x-navgator-proxy-verified` is stamped by the proxy onto the forwarded
 * request, only on the branch that actually compared the token in constant
 * time, and any inbound copy is stripped on every path before forwarding. A
 * client therefore cannot produce it, and degraded mode deliberately does
 * not stamp — so the Origin-less carve-out below stays closed exactly when
 * there is no session auth to lean on.
 */
const PROXY_VERIFIED_HEADER = "x-navgator-proxy-verified";
const PROXY_VERIFIED_VALUE = "1";

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
    // Now it's a pass only when the proxy stamped this request after
    // validating its session token; see PROXY_VERIFIED_HEADER above.
    // `.get()` rather than `.has()` deliberately — every other check in
    // this file reads headers via `.get()`, and this keeps
    // rejectUnsafeMutation callable with any headers object that only
    // implements `.get()` (NextRequest's real Headers implements both).
    if (request.headers.get(PROXY_VERIFIED_HEADER) === PROXY_VERIFIED_VALUE) return null;
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
