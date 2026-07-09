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

export function rejectUnsafeMutation(request: NextRequest): NextResponse | null {
  if (!isDashboardHostnameAllowed(getDashboardRequestHostname(request))) {
    return NextResponse.json(
      { success: false, error: "Dashboard requests must use a loopback hostname" },
      { status: 403 },
    );
  }
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
