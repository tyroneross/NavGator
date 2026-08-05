/**
 * The dashboard's only authenticated fetch path.
 *
 * WHY THIS EXISTS INSTEAD OF A COOKIE. The previous design put the session
 * token in a `navgator_session` cookie scoped to host `localhost`. Cookies
 * are keyed by host and ignore port (RFC 6265 s8.5), so the browser attached
 * that credential to EVERY `http://localhost:<anything>` the user visited —
 * every Vite dev server, every demo server some npm postinstall started,
 * every other agent's UI — and each of those could replay it verbatim
 * against the dashboard. `httpOnly` does not help: it stops page JS reading
 * the cookie, not the receiving server. `SameSite=strict` does not help
 * either: ports are not part of a "site", so `localhost:9999` ->
 * `localhost:3000` is same-site and strict never fires. No race, no user
 * interaction, just a live credential in ordinary dev servers' request logs.
 *
 * `sessionStorage` is keyed by scheme + host + PORT — the one browser store
 * that respects the boundary that matters here — and it is per-tab and
 * cleared when the tab closes. So the token lives there, and this module is
 * the only thing that reads it back out.
 *
 * HOW THE TOKEN ARRIVES. `web/proxy.ts` redeems the one-time `?nvt=<nonce>`
 * bootstrap and redirects to `/#t=<token>`. A URL fragment is never
 * transmitted to any server and is stripped from `Referer`, which is why the
 * OAuth implicit flow uses the same carrier. `adoptTokenFromHash()` moves it
 * into `sessionStorage` and clears the fragment via `history.replaceState`
 * so it does not linger in the URL bar or in session history.
 *
 * Adoption is LAZY as well as eager. `<SessionBootstrap />` calls it on
 * mount, but React runs child effects before parent effects, so a data hook
 * deeper in the tree can fire its first fetch before a layout-level effect
 * has run. `apiFetch` therefore adopts on demand too, which makes the whole
 * thing independent of mount order rather than dependent on a subtlety.
 */

const TOKEN_STORAGE_KEY = "navgator_session_token";
const TOKEN_HEADER_NAME = "x-navgator-token";

/** Matches `mintDashboardToken()`: 32 random bytes, hex-encoded. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const HASH_PATTERN = /^#t=([0-9a-f]{64})$/;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Storage can throw in hardened/partitioned contexts. Degrade to
    // unauthenticated rather than crashing the app shell.
    return null;
  }
}

/**
 * Move a `#t=<token>` fragment into `sessionStorage` and scrub it from the
 * URL. Safe to call repeatedly and from any point in the render tree.
 * Returns the token if one was adopted on this call.
 */
export function adoptTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;

  const match = HASH_PATTERN.exec(window.location.hash);
  if (!match) return null;
  const token = match[1];

  storage()?.setItem(TOKEN_STORAGE_KEY, token);

  // Immediately, and unconditionally: a fragment left in place would sit in
  // the URL bar, get copied into a bug report, and persist through history
  // navigation. `replaceState` rewrites the current entry rather than
  // pushing, so Back still behaves.
  try {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  } catch {
    // Non-fatal: the token is already stored.
  }

  return token;
}

/** The current session token, adopting one from the fragment if needed. */
export function getSessionToken(): string | null {
  const store = storage();
  const stored = store?.getItem(TOKEN_STORAGE_KEY);
  if (stored && TOKEN_PATTERN.test(stored)) return stored;
  return adoptTokenFromHash();
}

/**
 * `fetch` with the dashboard session token attached. Every client call to
 * `/api/*` goes through this — a bare `fetch` to an API route will 401,
 * which is the intended failure shape.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set(TOKEN_HEADER_NAME, token);
  return fetch(input, { ...init, headers });
}
