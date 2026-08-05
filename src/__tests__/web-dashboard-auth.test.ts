/**
 * SEC-001: NavGator dashboard trust boundary.
 *
 * Proves by EXECUTION, not by reading the code:
 *   1. The loopback (`Host`) check still rejects DNS-rebinding and
 *      suffix-confusion Host forgeries, driving the real `proxy()` with real
 *      `NextRequest` objects.
 *   2. The two-secret split holds. The browser-open URL carries a
 *      SINGLE-USE, TTL-bounded bootstrap nonce, not the session token; the
 *      session token reaches the browser only in a URL fragment; a second
 *      redemption of the same nonce yields no credential; an expired nonce
 *      yields no credential.
 *   3. No `Set-Cookie` on any path. The steady-state credential is a header
 *      sourced from `sessionStorage`, because a `localhost` cookie is
 *      broadcast to every other localhost PORT (RFC 6265 s8.5).
 *   4. `x-navgator-proxy-verified` is stamped only after real validation and
 *      is stripped when a client supplies it — the guard's invariant is now
 *      enforced rather than asserted in a comment.
 *   5. Degraded mode is opt-in, does not stamp, and a bogus token header
 *      with no Origin is still rejected there (the f2 regression).
 *   6. `NAVGATOR_DASHBOARD_TOKEN=""` is a hard 401, not a pass-through.
 *   7. `openInBrowser`'s argv never contains the session token.
 *
 * `next` is only installed under `web/node_modules` (not hoisted to the
 * repo root — see the header comment in
 * `web-registry-health-route.test.ts` for the general pattern), so a
 * top-level `import { NextRequest } from "next/server"` in THIS file (which
 * lives under `src/__tests__/`) would fail to resolve. `createRequire`
 * scoped at `web/package.json` resolves the SAME real `next/server` module
 * that `web/proxy.ts` itself imports (both hit
 * `web/node_modules/next/server.js`), without requiring `next` at the repo
 * root.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// Type-only, resolved as a plain relative path straight into
// `web/node_modules/next/server.d.ts` — NOT the bare `"next/server"`
// specifier, which this file (under `src/__tests__/`, outside `web/`)
// cannot resolve for type-checking purposes any more than it can at
// runtime. See the header comment above for the runtime side of this same
// constraint.
import type { NextRequest as NextRequestInstance } from "../../web/node_modules/next/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRequire = createRequire(path.join(here, "..", "..", "web", "package.json"));
const NextRequest = webRequire("next/server").NextRequest as new (
  url: string,
  init?: { headers?: Record<string, string> | Headers; method?: string },
) => NextRequestInstance;
type RealNextRequest = NextRequestInstance;

// web/proxy.ts imports "@/lib/server/request-guard" (a bundler-only alias
// vitest's `src` project has no path mapping for). `vi.mock` intercepts the
// specifier AS WRITTEN, regardless of whether it can resolve on its own, so
// redirecting it to the real relative file exercises genuine loopback logic
// rather than a stub. Same pattern as web-registry-health-route.test.ts.
vi.mock("@/lib/server/request-guard", async () => {
  return await import("../../web/lib/server/request-guard.js");
});

const REAL_TOKEN = "a1".repeat(32); // 64 hex chars, matches mintDashboardToken()'s shape
const REAL_NONCE = "e5".repeat(32); // independent value, same shape
const WRONG_TOKEN = "b2".repeat(32); // same length, different value
const SHORT_TOKEN = "c3".repeat(10); // deliberately the WRONG length

const STAMP = "x-navgator-proxy-verified";

type ProxyFn = (request: RealNextRequest) => ReturnType<typeof import("../../web/proxy.js").proxy>;

/**
 * `web/proxy.ts` reads its env once at module scope AND keeps the
 * nonce-burned flag there, so every case that needs a fresh, unredeemed
 * nonce must re-import a fresh module instance. `vi.resetModules()` clears
 * vitest's module registry (mocks registered via `vi.mock` above stay
 * registered — only the module CACHE is cleared), so the follow-up dynamic
 * `import()` re-executes proxy.ts's top-level reads.
 */
async function loadProxy(env: {
  token?: string;
  nonce?: string;
  insecure?: boolean;
}): Promise<ProxyFn> {
  if (env.token === undefined) delete process.env.NAVGATOR_DASHBOARD_TOKEN;
  else process.env.NAVGATOR_DASHBOARD_TOKEN = env.token;

  if (env.nonce === undefined) delete process.env.NAVGATOR_DASHBOARD_BOOTSTRAP;
  else process.env.NAVGATOR_DASHBOARD_BOOTSTRAP = env.nonce;

  if (env.insecure) process.env.NAVGATOR_DASHBOARD_INSECURE = "1";
  else delete process.env.NAVGATOR_DASHBOARD_INSECURE;

  vi.resetModules();
  const mod = await import("../../web/proxy.js");
  return mod.proxy as ProxyFn;
}

/** The common case: a real token plus a fresh, unredeemed nonce. */
function loadArmedProxy(): Promise<ProxyFn> {
  return loadProxy({ token: REAL_TOKEN, nonce: REAL_NONCE });
}

function req(url: string, headers: Record<string, string> = {}, method = "GET"): RealNextRequest {
  return new NextRequest(url, { headers, method });
}

async function bodyOf(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * What the proxy actually forwards downstream.
 *
 * `NextResponse.next({ request: { headers } })` does not mutate the incoming
 * request object — it encodes the override on the RESPONSE, as
 * `x-middleware-override-headers` (a comma-separated name list) plus one
 * `x-middleware-request-<name>` header per entry. Reading those is how a
 * test sees the headers a route handler will receive, which is the only way
 * to prove the stamp is applied on exactly the right branch.
 */
function forwardedHeader(response: { headers: Headers }, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name.toLowerCase()}`);
}

afterEach(() => {
  delete process.env.NAVGATOR_DASHBOARD_TOKEN;
  delete process.env.NAVGATOR_DASHBOARD_BOOTSTRAP;
  delete process.env.NAVGATOR_DASHBOARD_INSECURE;
  vi.restoreAllMocks();
});

// =============================================================================
// PART 1 — loopback + token enforcement, real proxy() + real NextRequest
// =============================================================================

describe("proxy() — loopback and token enforcement", () => {
  it("rejects a forged Host: evil.com (DNS rebinding) with 403", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "evil.com" }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toMatch(/loopback/i);
  });

  it("rejects a suffix-confusion Host: 127.0.0.1.evil.com with 403", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "127.0.0.1.evil.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects an API request carrying no token with 401", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "127.0.0.1:3000" }));
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).not.toMatch(/loopback/i);
  });

  it("rejects a wrong token (header) with 401", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": WRONG_TOKEN }),
    );
    expect(res.status).toBe(401);
  });

  it("passes the correct x-navgator-token header", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": REAL_TOKEN }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("a token of the wrong LENGTH is rejected with 401 and does not throw", async () => {
    const proxy = await loadArmedProxy();
    await expect(async () => {
      const res = await proxy(
        req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": SHORT_TOKEN }),
      );
      expect(res.status).toBe(401);
    }).not.toThrow();
  });

  it("the session cookie is NOT accepted — a stale cookie cannot authenticate", async () => {
    // Regression lock for the carrier change. A `localhost` cookie is
    // broadcast to every other localhost PORT, so any other local dev server
    // could have harvested one under the old design. It must not work now.
    const proxy = await loadArmedProxy();
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", {
        host: "localhost:3000",
        cookie: `navgator_session=${REAL_TOKEN}`,
      }),
    );
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// PART 2 — HIGH-1: single-use, TTL-bounded bootstrap nonce
// =============================================================================

describe("proxy() — bootstrap nonce (HIGH-1)", () => {
  it("redeems ?nvt=<nonce> into a 302 whose FRAGMENT carries the session token", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_NONCE}`, { host: "localhost:3000" }));
    expect(res.status).toBe(302);

    const location = res.headers.get("location") ?? "";
    // The token rides in the fragment, which no browser transmits and which
    // is stripped from Referer.
    expect(location).toContain(`#t=${REAL_TOKEN}`);
    // ...and nowhere a server can see it.
    const [beforeHash] = location.split("#");
    expect(beforeHash).not.toContain(REAL_TOKEN);
    expect(beforeHash).not.toContain(REAL_NONCE);
    expect(beforeHash).not.toContain("nvt=");
  });

  it("the SESSION TOKEN is never accepted as a bootstrap nonce", async () => {
    // The two secrets are independent. Anything scraped from `ps` is a
    // nonce; anything read from the 0600 file is a token. Neither
    // substitutes for the other.
    const proxy = await loadArmedProxy();
    const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_TOKEN}`, { host: "localhost:3000" }));
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();
  });

  it("a nonce redeemed TWICE yields no credential on the second attempt", async () => {
    const proxy = await loadArmedProxy();

    const first = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_NONCE}`, { host: "localhost:3000" }));
    expect(first.status).toBe(302);
    expect(first.headers.get("location") ?? "").toContain(`#t=${REAL_TOKEN}`);

    // This is the `ps` attacker: same nonce, moments later.
    const replay = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_NONCE}`, { host: "localhost:3000" }));
    expect(replay.status).not.toBe(302);
    expect(replay.headers.get("location")).toBeNull();
    expect(JSON.stringify([...replay.headers.entries()])).not.toContain(REAL_TOKEN);
  });

  it("an EXPIRED nonce yields no credential", async () => {
    // The TTL is measured from module init, so advancing the clock past it
    // before the request is what an attacker who reads `ps` a few minutes
    // late experiences.
    vi.useFakeTimers();
    try {
      const proxy = await loadArmedProxy();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1_000);
      const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_NONCE}`, { host: "localhost:3000" }));
      expect(res.status).not.toBe(302);
      expect(res.headers.get("location")).toBeNull();
      expect(JSON.stringify([...res.headers.entries()])).not.toContain(REAL_TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a nonce still inside its TTL is redeemed", async () => {
    vi.useFakeTimers();
    try {
      const proxy = await loadArmedProxy();
      vi.advanceTimersByTime(4 * 60 * 1000);
      const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_NONCE}`, { host: "localhost:3000" }));
      expect(res.status).toBe(302);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a wrong nonce sets no credential and does not redirect", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${WRONG_TOKEN}`, { host: "localhost:3000" }));
    expect(res.status).not.toBe(302);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

// =============================================================================
// PART 3 — HIGH-2: no cookie carrier anywhere
// =============================================================================

describe("proxy() — no Set-Cookie on any path (HIGH-2)", () => {
  const paths: Array<[string, string]> = [
    ["bootstrap redemption", `/?nvt=${REAL_NONCE}`],
    ["plain document", "/"],
    ["authorized API call", "/api/status"],
    ["unauthorized API call", "/api/components"],
  ];

  for (const [label, target] of paths) {
    it(`${label} sets no cookie`, async () => {
      const proxy = await loadArmedProxy();
      const headers: Record<string, string> = { host: "localhost:3000" };
      if (label === "authorized API call") headers["x-navgator-token"] = REAL_TOKEN;
      const res = await proxy(req(`http://127.0.0.1:3000${target}`, headers));
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  }
});

// =============================================================================
// PART 4 — f2: the proxy-verified stamp
// =============================================================================

describe("proxy() — x-navgator-proxy-verified stamp (f2)", () => {
  it("stamps the forwarded request only after validating the token", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": REAL_TOKEN }),
    );
    expect(res.status).toBe(200);
    expect(forwardedHeader(res, STAMP)).toBe("1");
  });

  it("STRIPS a client-supplied stamp on an unauthenticated public path", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(
      req("http://127.0.0.1:3000/", { host: "localhost:3000", [STAMP]: "1" }),
    );
    expect(res.status).toBe(200);
    expect(forwardedHeader(res, STAMP)).toBeNull();
  });

  it("a client-supplied stamp does NOT buy access to /api/*", async () => {
    const proxy = await loadArmedProxy();
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", [STAMP]: "1" }),
    );
    expect(res.status).toBe(401);
  });

  it("STRIPS a client-supplied stamp in degraded mode", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const proxy = await loadProxy({ insecure: true });
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", [STAMP]: "1" }),
    );
    expect(res.status).toBe(200);
    // Degraded mode must not manufacture proof-of-validation it never did.
    expect(forwardedHeader(res, STAMP)).toBeNull();
  });
});

// =============================================================================
// PART 5 — f4 / SEC-003: degraded mode is opt-in, empty token fails closed
// =============================================================================

describe("proxy() — degraded mode and empty token (f4, SEC-003)", () => {
  it("token UNSET with no opt-in fails closed with 401", async () => {
    const proxy = await loadProxy({});
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "localhost:3000" }));
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toMatch(/not configured/i);
  });

  it('token set to the EMPTY STRING is a hard 401, not a pass-through', async () => {
    const proxy = await loadProxy({ token: "" });
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "localhost:3000" }));
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toMatch(/empty/i);
  });

  it("an empty token is not satisfied by an empty request header either", async () => {
    const proxy = await loadProxy({ token: "" });
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": "" }),
    );
    expect(res.status).toBe(401);
  });

  it("NAVGATOR_DASHBOARD_INSECURE=1 degrades to loopback-only and warns once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const proxy = await loadProxy({ insecure: true });
    const res1 = await proxy(req("http://127.0.0.1:3000/api/status", { host: "localhost:3000" }));
    const res2 = await proxy(req("http://127.0.0.1:3000/api/status", { host: "localhost:3000" }));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/WITHOUT session auth/i);
  });

  it("degraded mode still rejects a forged Host", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const proxy = await loadProxy({ insecure: true });
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "evil.com" }));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// PART 6 — SEC-005: deny-by-default matcher
// =============================================================================

describe("proxy() — deny-by-default coverage (SEC-005)", () => {
  it("the matcher covers everything except Next's own build output", async () => {
    const mod = await import("../../web/proxy.js");
    expect(mod.config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });

  it("a hypothetical NEW non-/api route is authenticated by default", async () => {
    // The whole point of inverting the matcher: a route nobody remembered to
    // add to an allowlist must fail closed, not open.
    const proxy = await loadArmedProxy();
    const res = await proxy(req("http://127.0.0.1:3000/export", { host: "localhost:3000" }));
    expect(res.status).toBe(401);
  });

  it("the app shell and its static assets stay reachable without a token", async () => {
    const proxy = await loadArmedProxy();
    for (const target of ["/", "/icon.svg", "/navgator-logo.png", "/_next/whatever.js"]) {
      const res = await proxy(req(`http://127.0.0.1:3000${target}`, { host: "localhost:3000" }));
      expect(res.status, `${target} should be public`).toBe(200);
    }
  });
});

// =============================================================================
// PART 7 — real socket, real HTTP parsing, forged headers over the wire
// =============================================================================

/**
 * Spins up an actual `node:http` server that runs the real `proxy()` per
 * request. Proves the forged-header shapes above survive real HTTP request
 * parsing (chunked/keep-alive framing, header casing/whitespace handling by
 * Node's HTTP parser) rather than only synthetic `NextRequest` construction.
 * `fetch` cannot be used to forge `Host` — it is a forbidden header name
 * under the Fetch spec — so this uses `http.request` directly, which lets
 * Node's client send whatever `Host` header we hand it.
 */
async function startProxyServer(env: {
  token?: string;
  nonce?: string;
  insecure?: boolean;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const proxy = await loadProxy(env);

  let port = 0;
  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const url = `http://127.0.0.1:${port}${request.url ?? "/"}`;
        const nextRequest = new NextRequest(url, { headers, method: request.method ?? "GET" });
        const result = await proxy(nextRequest);

        if (result.headers.get("x-middleware-next") === "1") {
          const outHeaders: Record<string, string> = { "content-type": "application/json" };
          const stamp = result.headers.get(`x-middleware-request-${STAMP}`);
          if (stamp) outHeaders[STAMP] = stamp;
          response.writeHead(200, outHeaders);
          response.end(JSON.stringify({ success: true, passthrough: true }));
          return;
        }

        const outHeaders: Record<string, string> = {};
        result.headers.forEach((value, key) => {
          if (key.toLowerCase() === "x-middleware-next") return;
          outHeaders[key] = value;
        });
        const bodyText = await result.text();
        response.writeHead(result.status, outHeaders);
        response.end(bodyText);
      } catch (err) {
        response.writeHead(500);
        response.end(String(err));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function rawRequest(
  port: number,
  opts: { path: string; method?: string; headers?: Record<string, string> },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
        timeout: 15000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("rawRequest timed out")));
    request.on("error", reject);
    request.end();
  });
}

describe("proxy() — real socket, forged headers over real HTTP parsing", () => {
  let activeServer: { port: number; close: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }
  });

  it("real-socket: forged Host over the wire is rejected with 403", async () => {
    activeServer = await startProxyServer({ token: REAL_TOKEN, nonce: REAL_NONCE });
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "evil.com" },
    });
    expect(res.status).toBe(403);
  }, 20000);

  it("real-socket: no token over the wire is rejected with 401", async () => {
    activeServer = await startProxyServer({ token: REAL_TOKEN, nonce: REAL_NONCE });
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "127.0.0.1" },
    });
    expect(res.status).toBe(401);
  }, 20000);

  it("real-socket: correct x-navgator-token header over the wire passes and is stamped", async () => {
    activeServer = await startProxyServer({ token: REAL_TOKEN, nonce: REAL_NONCE });
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", "x-navgator-token": REAL_TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers[STAMP]).toBe("1");
  }, 20000);

  it("real-socket: a stale navgator_session cookie over the wire is rejected", async () => {
    activeServer = await startProxyServer({ token: REAL_TOKEN, nonce: REAL_NONCE });
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", cookie: `navgator_session=${REAL_TOKEN}` },
    });
    expect(res.status).toBe(401);
  }, 20000);

  it("real-socket: bootstrap redirect sets no cookie and keeps the token behind the '#'", async () => {
    activeServer = await startProxyServer({ token: REAL_TOKEN, nonce: REAL_NONCE });
    const res = await rawRequest(activeServer.port, {
      path: `/?nvt=${REAL_NONCE}`,
      headers: { host: "127.0.0.1" },
    });
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const location = res.headers.location ?? "";
    expect(location.split("#")[0]).not.toContain(REAL_TOKEN);
    expect(location).toContain(`#t=${REAL_TOKEN}`);
  }, 20000);

  it("real-socket: replaying the nonce over the wire gets nothing", async () => {
    activeServer = await startProxyServer({ token: REAL_TOKEN, nonce: REAL_NONCE });
    const first = await rawRequest(activeServer.port, {
      path: `/?nvt=${REAL_NONCE}`,
      headers: { host: "127.0.0.1" },
    });
    expect(first.status).toBe(302);
    const replay = await rawRequest(activeServer.port, {
      path: `/?nvt=${REAL_NONCE}`,
      headers: { host: "127.0.0.1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.location).toBeUndefined();
    expect(JSON.stringify(replay.headers)).not.toContain(REAL_TOKEN);
  }, 20000);
});

// =============================================================================
// PART 8 — rejectUnsafeMutation, now reading the proxy stamp (f2, f6)
// =============================================================================

describe("rejectUnsafeMutation (f2 / f6)", () => {
  async function loadGuard() {
    return await import("../../web/lib/server/request-guard.js");
  }

  function mutationRequest(headers: Record<string, string>) {
    const merged = { host: "localhost:3000", "content-type": "application/json", ...headers };
    return {
      headers: new Headers(merged),
      nextUrl: { protocol: "http:", host: "localhost:3000", hostname: "localhost" },
    } as unknown as Parameters<Awaited<ReturnType<typeof loadGuard>>["rejectUnsafeMutation"]>[0];
  }

  it("rejects a missing Origin when the proxy did not stamp the request", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({}));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("f2 REGRESSION: a bogus x-navgator-token no longer buys the Origin-less carve-out", async () => {
    // Reproduced live before this change: with the token env unset, a
    // POST /api/registry-health carrying `x-navgator-token: totally-fake`
    // and no Origin reached the handler (400), while the SAME request
    // without the header was rejected (403). Supplying garbage made the
    // request more privileged.
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({ "x-navgator-token": "totally-fake" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("even the REAL token, client-supplied, does not satisfy the guard on its own", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({ "x-navgator-token": REAL_TOKEN }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows a missing Origin when the proxy stamped the request", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({ [STAMP]: "1" }));
    expect(res).toBeNull();
  });

  it("still rejects a cross-origin Origin even with the stamp present", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(
      mutationRequest({ origin: "http://evil.example.com", [STAMP]: "1" }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("still rejects sec-fetch-site: cross-site", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({ "sec-fetch-site": "cross-site" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});

// =============================================================================
// PART 9 — HIGH-1: the session token never reaches an argv
// =============================================================================

/**
 * The auditor's live reproduction was `ps -axww -o pid,user,command`
 * printing `/bin/sh -c open http://localhost:3000/?nvt=<token>`. The
 * assertion that closes it is on the exact string handed to the
 * browser-open call, because that string IS the argv.
 */
describe("navgator ui — browser-open argv (HIGH-1)", () => {
  it("mints two independent secrets", async () => {
    const { mintDashboardToken, mintBootstrapNonce } = await import("../dashboard-session.js");
    const token = mintDashboardToken();
    const nonce = mintBootstrapNonce();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce).not.toBe(token);
  });

  it("the session file is written at 0600 and unlinked on shutdown (SEC-009)", async () => {
    // The 0600 file is now the ONLY way a non-browser local client can
    // obtain the session token, since it no longer travels through a URL —
    // so both its mode and its removal are load-bearing. The previous
    // SIGINT/SIGTERM handler killed the server without unlinking, leaving a
    // live-looking credential at rest after the thing it authenticated was
    // gone.
    const fs = await import("node:fs");
    const {
      writeDashboardSession,
      readDashboardSession,
      deleteDashboardSession,
      dashboardSessionPath,
      mintDashboardToken,
    } = await import("../dashboard-session.js");

    const token = mintDashboardToken();
    writeDashboardSession(token, 3000);

    const file = dashboardSessionPath();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readDashboardSession()?.token).toBe(token);

    deleteDashboardSession();
    expect(fs.existsSync(file)).toBe(false);
    expect(readDashboardSession()).toBeNull();

    // Idempotent: a second signal must not throw out of a shutdown handler.
    expect(() => deleteDashboardSession()).not.toThrow();
  });

  it("the browser-open URL is built from the nonce and cannot carry the token", async () => {
    const { bootstrapUrl } = await import("../cli/commands/misc.js");
    const { mintDashboardToken, mintBootstrapNonce } = await import("../dashboard-session.js");
    const token = mintDashboardToken();
    const nonce = mintBootstrapNonce();

    const url = bootstrapUrl(3000, nonce);
    expect(url).toContain(nonce);
    expect(url).not.toContain(token);
  });

  it("openInBrowser spawns an argv array with no shell, and the argv omits the session token", async () => {
    // This is the assertion the auditor's `ps` reproduction demands: on the
    // EXACT strings handed to the spawn call, which are the argv.
    const { openInBrowser } = await import("../cli/commands/misc.js");
    const { mintDashboardToken, mintBootstrapNonce } = await import("../dashboard-session.js");
    const token = mintDashboardToken();
    const nonce = mintBootstrapNonce();

    const spawned: Array<{ command: string; args: string[] }> = [];
    const recordingSpawn = ((command: string, args: string[]) => {
      spawned.push({ command, args });
      return { on: () => {}, unref: () => {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    openInBrowser(`http://localhost:3000/?nvt=${nonce}`, recordingSpawn);

    expect(spawned).toHaveLength(1);
    const argv = [spawned[0].command, ...spawned[0].args];

    // No shell interposed. The previous `exec(\`${cmd} ${url}\`)` produced a
    // `/bin/sh -c <whole line>` process whose argv was a SECOND copy of the
    // URL, which is literally what `ps -axww` printed.
    expect(argv[0]).not.toMatch(/(^|\/)(sh|bash|zsh)$/);
    expect(argv).not.toContain("-c");

    // The control: the session token is in no element of the argv.
    for (const entry of argv) {
      expect(entry).not.toContain(token);
    }
    // Negative control — the test would still pass on an argv that carried
    // nothing at all without this.
    expect(argv.join(" ")).toContain(nonce);
  });

  it("builds a shell-free argv on every platform", async () => {
    const { browserOpenArgv } = await import("../cli/commands/misc.js");
    const url = "http://localhost:3000/?nvt=deadbeef&x=1";
    for (const platform of ["darwin", "linux", "win32"] as NodeJS.Platform[]) {
      const { command, args } = browserOpenArgv(url, platform);
      // The URL is a single, whole argv element — never spliced into a
      // command line where `?` and `&` are shell metacharacters.
      expect(args).toContain(url);
      expect(command).not.toMatch(/(^|\/)(sh|bash|zsh)$/);
    }
  });
});

// =============================================================================
// PART 10 — live standalone proof (local only, opt-in)
// =============================================================================

/**
 * CI runs `npm test` BEFORE `npm run build`, so `web/server.cjs` does not
 * exist there — this block is skipped unless explicitly opted in with
 * NAVGATOR_LIVE_DASHBOARD=1, and even then only runs if the standalone
 * output is actually present. Run locally with:
 *   npm run build && NAVGATOR_LIVE_DASHBOARD=1 npx vitest run src/__tests__/web-dashboard-auth.test.ts
 */
const LIVE = process.env.NAVGATOR_LIVE_DASHBOARD === "1";

describe.skipIf(!LIVE)("proxy() — live standalone server (opt-in, local only)", () => {
  let child: import("node:child_process").ChildProcess | undefined;
  let port = 0;
  const liveToken = "d4".repeat(32);
  const liveNonce = "4d".repeat(32);

  beforeEach(async () => {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const packageRoot = path.resolve(here, "..", "..");
    const serverJs = path.join(packageRoot, "web", "server.cjs");
    if (!fs.existsSync(serverJs)) {
      throw new Error(
        `NAVGATOR_LIVE_DASHBOARD=1 was set but ${serverJs} does not exist. Run \`npm run build\` (or at least \`npm run build:web\`) first.`,
      );
    }

    port = 41000 + Math.floor(Math.random() * 4000);
    child = spawn("node", [serverJs], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NAVGATOR_DASHBOARD_TOKEN: liveToken,
        NAVGATOR_DASHBOARD_BOOTSTRAP: liveNonce,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 15000); // proceed even without an explicit ready line
      const onData = (data: Buffer) => {
        const msg = data.toString();
        if (/ready|started|listening/i.test(msg)) {
          clearTimeout(timeout);
          resolve();
        }
      };
      child!.stdout?.on("data", onData);
      child!.stderr?.on("data", onData);
      child!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  afterAll(() => {
    child?.kill();
  });

  it("forged Host against the real standalone server is rejected with 403", async () => {
    const res = await rawRequest(port, { path: "/api/status", headers: { host: "evil.com" } });
    expect(res.status).toBe(403);
  });

  it("no token against the real standalone server is rejected with 401", async () => {
    const res = await rawRequest(port, { path: "/api/status", headers: { host: "127.0.0.1" } });
    expect(res.status).toBe(401);
  });

  it("a wrong token against the real standalone server is rejected with 401", async () => {
    const res = await rawRequest(port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", "x-navgator-token": "9".repeat(64) },
    });
    expect(res.status).toBe(401);
  });

  it("bootstrap redeems ONCE against the real standalone server: no cookie, token behind '#', replay dead", async () => {
    // Both requests hit the SAME server process, deliberately. `beforeEach`
    // boots a fresh one per test, and an earlier version of this test split
    // the two requests across tests — which passed the replay against a
    // freshly-booted, unburned server and proved nothing. The property that
    // matters is that the burn survives in the real standalone runtime's
    // module scope across requests, which only a same-process replay shows.
    const first = await rawRequest(port, {
      path: `/?nvt=${liveNonce}`,
      headers: { host: "127.0.0.1" },
    });
    expect(first.status).toBe(302);
    expect(first.headers["set-cookie"]).toBeUndefined();
    const location = first.headers.location ?? "";
    expect(location).toContain(`#t=${liveToken}`);
    expect(location.split("#")[0]).not.toContain(liveToken);

    // The `ps` attacker, replaying the nonce it scraped from the argv.
    const replay = await rawRequest(port, {
      path: `/?nvt=${liveNonce}`,
      headers: { host: "127.0.0.1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.location).toBeUndefined();
    expect(JSON.stringify(replay.headers)).not.toContain(liveToken);
    expect(replay.body).not.toContain(liveToken);
  });

  it("the token header reaches /api/status (a route with NO per-route guard) and gets 200", async () => {
    const res = await rawRequest(port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", "x-navgator-token": liveToken },
    });
    expect(res.status).toBe(200);
  });

  it("a client-supplied proxy-verified stamp does not authorize anything", async () => {
    const res = await rawRequest(port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", [STAMP]: "1" },
    });
    expect(res.status).toBe(401);
  });
}, 60000);
