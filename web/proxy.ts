import { NextRequest, NextResponse } from "next/server";
import { getDashboardRequestHostname, isDashboardHostnameAllowed } from "@/lib/server/request-guard";

/**
 * NavGator dashboard trust boundary (SEC-001).
 *
 * The loopback `Host` check below is the DNS-rebinding defense and stays
 * exactly as it was: a browser can't forge `Host`, but a page at
 * evil.com that resolves to 127.0.0.1 CAN make the browser send
 * `Host: evil.com`, and this rejects that. It is necessary but not
 * sufficient — loopback only proves the request came from THIS machine,
 * not that it came from `navgator ui`. Any other local process (a stray
 * npm postinstall script, another agent, any sandboxed-but-networked tool)
 * can send `Host: 127.0.0.1:<port>` too, and the loopback check alone would
 * let it read the full architecture graph and every registered project
 * path.
 *
 * The token below closes that gap. `navgator ui` mints a random per-launch
 * token (`src/dashboard-session.ts`), writes it to a 0600 file only the
 * invoking user can read, and passes it to this server via
 * `NAVGATOR_DASHBOARD_TOKEN`. The CLI's browser-open URL carries it once as
 * `?nvt=<token>`; this proxy trades that one-time query param for an
 * httpOnly cookie via a 302 redirect (so the token never sits in the URL
 * bar, browser history, or an outbound Referer header) and from then on
 * requires either that cookie or an `x-navgator-token` header equal to the
 * real token on every `/api/*` request.
 */

const DASHBOARD_TOKEN = process.env.NAVGATOR_DASHBOARD_TOKEN;

const SESSION_COOKIE_NAME = "navgator_session";
const TOKEN_HEADER_NAME = "x-navgator-token";
const BOOTSTRAP_QUERY_PARAM = "nvt";
const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // ~12h

/**
 * Constant-time, length-safe string compare. Deliberately does NOT use
 * `node:crypto`'s `timingSafeEqual`: this proxy runs on Next's edge
 * runtime by default, and edge runtimes are not guaranteed to expose the
 * full `node:crypto` surface (verified by actually running the built
 * standalone server for this change rather than assumed — see the
 * implementation notes for the observed result). A manual XOR accumulator
 * needs nothing beyond plain JS and never throws on a length mismatch,
 * unlike `timingSafeEqual`, which throws when its two buffers differ in
 * length — exactly the shape an attacker's guessed token most often takes.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 401 });
}

let warnedDegraded = false;

/**
 * True when the request carries a token (cookie or header) that matches
 * `DASHBOARD_TOKEN`. Only meaningful when `DASHBOARD_TOKEN` is set — callers
 * must handle the degraded (token-unset) case separately.
 */
function hasValidToken(request: NextRequest, token: string): boolean {
  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken && timingSafeStringEqual(cookieToken, token)) return true;

  const headerToken = request.headers.get(TOKEN_HEADER_NAME);
  if (headerToken && timingSafeStringEqual(headerToken, token)) return true;

  return false;
}

export function proxy(request: NextRequest) {
  if (!isDashboardHostnameAllowed(getDashboardRequestHostname(request))) {
    return NextResponse.json(
      { success: false, error: "Dashboard API requests must use a loopback hostname" },
      { status: 403 },
    );
  }

  const { pathname, searchParams } = request.nextUrl;

  // --- Bootstrap handoff: GET /?nvt=<token> -> httpOnly cookie + redirect ---
  // Only meaningful on the document route, and only when a real token is
  // configured. A wrong or missing `nvt` value here is simply not a
  // bootstrap attempt; fall through to normal handling for "/" below
  // (the document route itself is not token-gated — only /api/* is).
  if (pathname === "/" && DASHBOARD_TOKEN) {
    const candidate = searchParams.get(BOOTSTRAP_QUERY_PARAM);
    if (candidate && timingSafeStringEqual(candidate, DASHBOARD_TOKEN)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/";
      redirectUrl.search = "";
      const response = NextResponse.redirect(redirectUrl, { status: 302 });
      response.cookies.set(SESSION_COOKIE_NAME, DASHBOARD_TOKEN, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        // Loopback-only traffic is plain http; `secure: true` would make
        // the browser silently drop the cookie and every subsequent /api
        // call would 401.
        secure: false,
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      });
      return response;
    }
  }

  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // --- /api/* enforcement ---
  if (!DASHBOARD_TOKEN) {
    // Degraded dev mode: `navgator ui` always sets NAVGATOR_DASHBOARD_TOKEN.
    // An unset token means someone is running `next dev` / `dev:web`
    // directly for web development. An attacker cannot set or unset this
    // server's own environment, so falling back to loopback-only
    // enforcement (already checked above) is a deliberate, documented
    // trade rather than a silent hole — but it must be loud so a developer
    // never mistakes it for the real trust boundary.
    if (!warnedDegraded) {
      warnedDegraded = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[navgator] NAVGATOR_DASHBOARD_TOKEN is not set — the dashboard is running WITHOUT session " +
          "auth. Only the loopback Host check applies. This is expected under `next dev`/`dev:web`; " +
          "if you see this from `navgator ui`, the token was not passed through and this build should " +
          "be treated as insecure against other local processes.",
      );
    }
    return NextResponse.next();
  }

  if (!hasValidToken(request, DASHBOARD_TOKEN)) {
    return unauthorized("Dashboard API requests require a valid session token");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
