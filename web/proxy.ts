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
 * TWO SECRETS, because the first version of this leaked its single secret
 * through both of its carriers.
 *
 *   NAVGATOR_DASHBOARD_BOOTSTRAP — a single-use, ~5-minute nonce. It is the
 *   only value that travels in the browser-open URL, and therefore the only
 *   value the process table can expose (`ps -axww` reproduced the original
 *   leak live). Redeeming it burns it in module scope, so a replay by
 *   whoever ran `ps` gets nothing. Its worst case is a race with the user's
 *   own browser over a few hundred milliseconds, not a session-long
 *   credential.
 *
 *   NAVGATOR_DASHBOARD_TOKEN — the session credential. It never appears in
 *   an argv or a URL query string. Redemption hands it to the browser in a
 *   URL FRAGMENT (`/#t=<token>`), which is never sent to any server and is
 *   stripped from `Referer`; the client bootstrap moves it into
 *   `sessionStorage` and clears the fragment. Every subsequent `/api/*`
 *   call carries it as an `x-navgator-token` header.
 *
 * Why not a cookie for the steady state (the previous design): cookies are
 * keyed by host and IGNORE port (RFC 6265 s8.5). A `navgator_session` cookie
 * scoped to `localhost` is broadcast by the browser to EVERY
 * `http://localhost:<anything>` the user visits — any Vite dev server, any
 * demo server an npm postinstall started, any other agent's UI — each of
 * which can replay it verbatim. `httpOnly` doesn't help (it stops page JS
 * reading the cookie, not the receiving server), and `SameSite=strict`
 * doesn't fire because ports are not part of a "site", so
 * localhost:9999 -> localhost:3000 is same-site. `sessionStorage` is keyed
 * by scheme+host+PORT, which is the boundary that actually needs to hold.
 * There is no `Set-Cookie` on any path in this file.
 */

/**
 * `undefined` means the variable was never set; `""` means it was set to
 * empty. The original falsiness check conflated the two, so
 * `NAVGATOR_DASHBOARD_TOKEN=""` silently entered degraded mode while logging
 * "is not set", which was untrue. Set-but-empty is now a hard failure.
 */
const DASHBOARD_TOKEN: string | undefined = process.env.NAVGATOR_DASHBOARD_TOKEN;
const BOOTSTRAP_NONCE: string | undefined = process.env.NAVGATOR_DASHBOARD_BOOTSTRAP;

/**
 * Degraded (no session auth) mode is now EXPLICIT opt-in. Previously an
 * unset token silently degraded to loopback-only, and the warning that was
 * supposed to make that loud never reached a terminal because the CLI
 * swallowed the child's stdio. An unset token with no opt-in now fails
 * closed.
 */
const INSECURE_OPT_IN = process.env.NAVGATOR_DASHBOARD_INSECURE === "1";

const TOKEN_HEADER_NAME = "x-navgator-token";
const BOOTSTRAP_QUERY_PARAM = "nvt";

/**
 * Stamped by this proxy onto the FORWARDED request, and only on the path
 * that actually validated a token. `request-guard.ts` reads this instead of
 * the client-supplied `x-navgator-token`, which removes a live hole: with
 * the token env unset, a `POST /api/registry-health` carrying
 * `x-navgator-token: totally-fake` and no `Origin` reached the handler,
 * because the guard only checked that the header was PRESENT and trusted a
 * comment about proxy ordering to make that sound. Any inbound copy of this
 * header is stripped below before the request is forwarded, on every path,
 * so a client cannot supply it.
 */
const PROXY_VERIFIED_HEADER = "x-navgator-proxy-verified";
const PROXY_VERIFIED_VALUE = "1";

/**
 * How long an unredeemed bootstrap nonce stays live, measured from module
 * init (which is server start). Long enough for a browser to cold-start on a
 * loaded machine, short enough that a nonce scraped out of `ps` is dead
 * before an attacker can act on it. Redemption burns it well before this.
 */
const BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const BOOTSTRAP_MINTED_AT = Date.now();

/** Burned on first successful redemption. Replay gets no credential. */
let bootstrapRedeemed = false;

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

/**
 * Forward the request with any client-supplied `x-navgator-proxy-verified`
 * removed, optionally re-adding it under this proxy's own authority. Every
 * `NextResponse.next()` in this file goes through here — a path that forgot
 * to strip would let a client forge the stamp the guard trusts.
 */
function forward(request: NextRequest, verified: boolean): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(PROXY_VERIFIED_HEADER);
  if (verified) headers.set(PROXY_VERIFIED_HEADER, PROXY_VERIFIED_VALUE);
  return NextResponse.next({ request: { headers } });
}

let warnedDegraded = false;

/**
 * Paths served without a session token: the app shell itself and static
 * assets. The shell is inert — `app/page.tsx` is `"use client"`,
 * `app/layout.tsx` loads no data, and there is no `"use server"` anywhere in
 * this tree — so it discloses nothing; every byte of project data comes back
 * through `/api/*`, which is gated.
 *
 * This exists because the matcher is now deny-by-default
 * (`/((?!_next/static|_next/image|favicon.ico).*)`) rather than the previous
 * `["/", "/api/:path*"]` allowlist. Under an allowlist, any route added
 * later — a new `/export` handler, a server action, an RSC data route — is
 * unauthenticated until someone remembers to extend the matcher. Inverting
 * it makes "forgot to think about auth" fail closed instead of open.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/manifest.json") {
    return true;
  }
  // Static assets shipped from web/public: icons, logos, placeholder art.
  return /\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff2?|ttf)$/i.test(pathname);
}

/**
 * True when the request carries an `x-navgator-token` header matching
 * `DASHBOARD_TOKEN`. Header only — see the file header for why the cookie
 * form was removed rather than kept alongside.
 */
function hasValidToken(request: NextRequest, token: string): boolean {
  const headerToken = request.headers.get(TOKEN_HEADER_NAME);
  return Boolean(headerToken) && timingSafeStringEqual(headerToken as string, token);
}

/**
 * Trade a valid, unburned, unexpired `?nvt=<nonce>` for the session token,
 * delivered in a URL fragment.
 *
 * Returns `null` when this is not a redemption (wrong/absent/expired/already
 * -burned nonce), in which case the caller falls through to normal handling.
 * A failed redemption is deliberately indistinguishable from a plain visit:
 * it sets no credential and says nothing about why.
 */
function tryRedeemBootstrap(request: NextRequest): NextResponse | null {
  if (!BOOTSTRAP_NONCE || !DASHBOARD_TOKEN) return null;
  if (bootstrapRedeemed) return null;
  if (Date.now() - BOOTSTRAP_MINTED_AT > BOOTSTRAP_TTL_MS) return null;

  const candidate = request.nextUrl.searchParams.get(BOOTSTRAP_QUERY_PARAM);
  if (!candidate || !timingSafeStringEqual(candidate, BOOTSTRAP_NONCE)) return null;

  // Burn BEFORE responding. Two concurrent redemptions of the same nonce
  // must not both win.
  bootstrapRedeemed = true;

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/";
  redirectUrl.search = "";
  // The fragment is the whole point: browsers never transmit it to a server
  // and strip it from `Referer`, so the session token reaches page JS
  // without ever crossing a network boundary a second time or entering any
  // server's access log. Same handoff shape as the OAuth implicit flow.
  redirectUrl.hash = `t=${DASHBOARD_TOKEN}`;
  return NextResponse.redirect(redirectUrl, { status: 302 });
}

export function proxy(request: NextRequest) {
  if (!isDashboardHostnameAllowed(getDashboardRequestHostname(request))) {
    return NextResponse.json(
      { success: false, error: "Dashboard API requests must use a loopback hostname" },
      { status: 403 },
    );
  }

  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    const redeemed = tryRedeemBootstrap(request);
    if (redeemed) return redeemed;
  }

  if (isPublicPath(pathname)) {
    return forward(request, false);
  }

  // --- Everything else (deny-by-default) requires the session token ---
  if (DASHBOARD_TOKEN === undefined) {
    if (!INSECURE_OPT_IN) {
      // Fail closed. `navgator ui` always sets the token; an unset token
      // with no opt-in means the server was started some other way and its
      // trust boundary does not exist.
      return unauthorized(
        "Dashboard session token is not configured. Launch with `navgator ui`, or set " +
          "NAVGATOR_DASHBOARD_INSECURE=1 to run without session auth for local web development.",
      );
    }
    if (!warnedDegraded) {
      warnedDegraded = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[navgator] NAVGATOR_DASHBOARD_INSECURE=1 — the dashboard is running WITHOUT session auth. " +
          "Only the loopback Host check applies, so any other process on this machine can read and " +
          "mutate it. This is expected under `npm run dev:web`; if you see this from `navgator ui`, " +
          "the token was not passed through and this build is insecure against other local processes.",
      );
    }
    // Deliberately NOT stamped. Degraded mode must not manufacture the
    // proof-of-validation that `rejectUnsafeMutation` trusts, so an
    // Origin-less mutation still fails there.
    return forward(request, false);
  }

  if (DASHBOARD_TOKEN === "") {
    // Set-but-empty. Never degrade on this: an empty token cannot be matched
    // by any request, and treating it as "unset" is how a misconfigured
    // launcher silently ships an unauthenticated dashboard.
    return unauthorized("Dashboard session token is empty; refusing to serve API requests");
  }

  if (!hasValidToken(request, DASHBOARD_TOKEN)) {
    return unauthorized("Dashboard API requests require a valid session token");
  }

  return forward(request, true);
}

export const config = {
  // Deny-by-default (SEC-005). Next's own build output and the favicon are
  // excluded at the matcher level because they are served before any
  // application code; everything else reaches `proxy()`, which decides.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
