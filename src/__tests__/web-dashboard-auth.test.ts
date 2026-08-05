/**
 * SEC-001: NavGator dashboard trust boundary.
 *
 * Proves three things by EXECUTION, not by reading the code:
 *   1. The existing loopback (`Host`) check still rejects DNS-rebinding and
 *      suffix-confusion Host forgeries, driving the real `proxy()` with real
 *      `NextRequest` objects.
 *   2. The new per-session token closes the "any other local process" gap:
 *      no token, wrong token, and a token of the wrong LENGTH are all
 *      rejected with a distinct 401 (not the 403 used for loopback/origin
 *      failures); a matching cookie or header passes; the bootstrap
 *      `?nvt=` handoff sets an httpOnly/SameSite=strict cookie via redirect
 *      and never leaks the token into the redirect Location.
 *   3. `rejectUnsafeMutation`'s missing-Origin carve-out is now conditioned
 *      on the token header being present, not a free pass for every
 *      non-browser client.
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
const WRONG_TOKEN = "b2".repeat(32); // same length, different value
const SHORT_TOKEN = "c3".repeat(10); // deliberately the WRONG length

type ProxyFn = (request: RealNextRequest) => ReturnType<typeof import("../../web/proxy.js").proxy>;

/**
 * `web/proxy.ts` reads `NAVGATOR_DASHBOARD_TOKEN` once at module scope, so
 * exercising it under different token values means re-importing a fresh
 * module instance per case. `vi.resetModules()` clears vitest's module
 * registry (mocks registered via `vi.mock` above stay registered — only the
 * module CACHE is cleared), so the follow-up dynamic `import()` re-executes
 * proxy.ts's top-level `const DASHBOARD_TOKEN = process.env...` read.
 */
async function loadProxy(token: string | undefined): Promise<ProxyFn> {
  if (token === undefined) {
    delete process.env.NAVGATOR_DASHBOARD_TOKEN;
  } else {
    process.env.NAVGATOR_DASHBOARD_TOKEN = token;
  }
  vi.resetModules();
  const mod = await import("../../web/proxy.js");
  return mod.proxy as ProxyFn;
}

function req(url: string, headers: Record<string, string> = {}, method = "GET"): RealNextRequest {
  return new NextRequest(url, { headers, method });
}

async function bodyOf(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  delete process.env.NAVGATOR_DASHBOARD_TOKEN;
  vi.restoreAllMocks();
});

// =============================================================================
// PART 1 — unit-level, real proxy() + real NextRequest
// =============================================================================

describe("proxy() — real NextRequest, module-scope token", () => {
  it("rejects a forged Host: evil.com (DNS rebinding) with 403", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "evil.com" }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toMatch(/loopback/i);
  });

  it("rejects a suffix-confusion Host: 127.0.0.1.evil.com with 403", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "127.0.0.1.evil.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects Host: 127.0.0.1:3000 with NO token configured with 401", async () => {
    // Module-scope token IS set in this test (loadProxy(REAL_TOKEN)), so this
    // case is "request carries no token at all" (not "server is degraded"),
    // which is covered separately below.
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(req("http://127.0.0.1:3000/api/status", { host: "127.0.0.1:3000" }));
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).not.toMatch(/loopback/i);
  });

  it("rejects Host: localhost:3000 with a wrong token (header) with 401", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": WRONG_TOKEN }),
    );
    expect(res.status).toBe(401);
  });

  it("passes Host: localhost:3000 with the correct x-navgator-token header", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": REAL_TOKEN }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes Host: localhost:3000 with the correct navgator_session cookie", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(
      req("http://127.0.0.1:3000/api/status", {
        host: "localhost:3000",
        cookie: `navgator_session=${REAL_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("bootstrap GET /?nvt=<correct> issues a 302 + httpOnly/SameSite=strict cookie, no token in Location", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${REAL_TOKEN}`, { host: "localhost:3000" }));
    expect(res.status).toBe(302);

    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain(REAL_TOKEN);
    expect(location).not.toContain("nvt=");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`navgator_session=${REAL_TOKEN}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
  });

  it("bootstrap GET /?nvt=<wrong> sets no cookie", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    const res = await proxy(req(`http://127.0.0.1:3000/?nvt=${WRONG_TOKEN}`, { host: "localhost:3000" }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a token of the wrong LENGTH is rejected with 401 and does not throw", async () => {
    const proxy = await loadProxy(REAL_TOKEN);
    await expect(async () => {
      const res = await proxy(
        req("http://127.0.0.1:3000/api/status", { host: "localhost:3000", "x-navgator-token": SHORT_TOKEN }),
      );
      expect(res.status).toBe(401);
    }).not.toThrow();
  });

  it("degraded dev mode: token unset falls back to loopback-only enforcement and warns once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const proxy = await loadProxy(undefined);
    const res1 = await proxy(req("http://127.0.0.1:3000/api/status", { host: "localhost:3000" }));
    const res2 = await proxy(req("http://127.0.0.1:3000/api/status", { host: "localhost:3000" }));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/without session auth/i);
  });
});

// =============================================================================
// PART 2 — real socket, real HTTP parsing, forged headers over the wire
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
async function startProxyServer(token: string | undefined): Promise<{ port: number; close: () => Promise<void> }> {
  const proxy = await loadProxy(token);

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
          response.writeHead(200, { "content-type": "application/json" });
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
        timeout: 5000,
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
    activeServer = await startProxyServer(REAL_TOKEN);
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("real-socket: no token over the wire is rejected with 401", async () => {
    activeServer = await startProxyServer(REAL_TOKEN);
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "127.0.0.1" },
    });
    expect(res.status).toBe(401);
  });

  it("real-socket: correct x-navgator-token header over the wire passes", async () => {
    activeServer = await startProxyServer(REAL_TOKEN);
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", "x-navgator-token": REAL_TOKEN },
    });
    expect(res.status).toBe(200);
  });

  it("real-socket: correct navgator_session cookie over the wire passes", async () => {
    activeServer = await startProxyServer(REAL_TOKEN);
    const res = await rawRequest(activeServer.port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", cookie: `navgator_session=${REAL_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("real-socket: bootstrap redirect over the wire sets a cookie and omits the token from Location", async () => {
    activeServer = await startProxyServer(REAL_TOKEN);
    const res = await rawRequest(activeServer.port, {
      path: `/?nvt=${REAL_TOKEN}`,
      headers: { host: "127.0.0.1" },
    });
    expect(res.status).toBe(302);
    const location = res.headers.location ?? "";
    expect(location).not.toContain(REAL_TOKEN);
    const setCookie = Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"].join("; ")
      : (res.headers["set-cookie"] ?? "");
    expect(setCookie).toContain(REAL_TOKEN);
    expect(setCookie.toLowerCase()).toContain("httponly");
  }, 10000);
});

// =============================================================================
// PART 3 — rejectUnsafeMutation regression
// =============================================================================

describe("rejectUnsafeMutation (SEC-001 tightening)", () => {
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

  it("rejects a missing Origin when no token header is present", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({}));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows a missing Origin when the x-navgator-token header is present", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(mutationRequest({ "x-navgator-token": REAL_TOKEN }));
    expect(res).toBeNull();
  });

  it("still rejects a cross-origin Origin even with the token header present", async () => {
    const { rejectUnsafeMutation } = await loadGuard();
    const res = rejectUnsafeMutation(
      mutationRequest({ origin: "http://evil.example.com", "x-navgator-token": REAL_TOKEN }),
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
// PART 4 — live standalone proof (local only, opt-in)
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 6000); // proceed even without an explicit ready line
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

  it("bootstrap against the real standalone server sets a cookie", async () => {
    const res = await rawRequest(port, {
      path: `/?nvt=${liveToken}`,
      headers: { host: "127.0.0.1" },
    });
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("cookie against the real standalone server reaches /api/status (a route with NO per-route guard) and gets 200", async () => {
    const res = await rawRequest(port, {
      path: "/api/status",
      headers: { host: "127.0.0.1", cookie: `navgator_session=${liveToken}` },
    });
    expect(res.status).toBe(200);
  });
}, 30000);
