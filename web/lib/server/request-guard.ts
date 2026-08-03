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
  if (!origin) return null;
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
