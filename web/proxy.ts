import { NextRequest, NextResponse } from "next/server";
import { getDashboardRequestHostname, isDashboardHostnameAllowed } from "@/lib/server/request-guard";

export function proxy(request: NextRequest) {
  if (!isDashboardHostnameAllowed(getDashboardRequestHostname(request))) {
    return NextResponse.json(
      { success: false, error: "Dashboard API requests must use a loopback hostname" },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
