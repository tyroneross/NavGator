import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// SEC-007: /api/coverage validated its caller-supplied `path` query param
// against the registered-project allowlist (isRegisteredProjectPath,
// web/lib/server/coverage.ts); its nine GET siblings (status, graph,
// components, connections, prompts, rules, trace, subgraph, settings) did
// not, and neither did the two mutation routes that accept a `path`-shaped
// body value (POST /api/scan, POST /api/settings) or POST /api/prompts's
// scan trigger. web/lib/server/project-path.ts hoists that validation into
// one shared helper (resolveProjectPath / resolveProjectPathFromBody) that
// every route now calls. This file exercises the guard through the actual
// route handlers, table-driven per GET route so a future route that forgets
// to call the guard is visibly missing from GET_ROUTES below.
//
// Like web-coverage-route.test.ts and web-registry-health-route.test.ts,
// these route.ts files import several "@/lib/server/*" modules via
// bundler-only alias resolution that vitest's `src` project has no path
// mapping for, so those bare specifiers can't resolve on their own. `vi.mock`
// intercepts import specifiers as written (it does not require the bare
// specifier to resolve by itself), so real implementations are loaded via a
// relative path for project-path.ts (the module under test), the real
// architecture-storage.ts (so routes degrade to their normal "no scan data"
// empty-but-200 shape rather than throwing), the real request-guard.ts
// (exercising the genuine mutation guard), and the real transform.ts (so
// POST /api/prompts's shape-mapping runs unmocked). navgator-cli.ts is fully
// mocked, per the requirement that no test here spawns a real process or
// touches a real project directory.
// This file imports ten distinct route.ts modules (plus their shared deps:
// coverage.ts, registry-journal.ts, architecture-storage.ts, request-guard.ts,
// transform.ts) into one vitest fork -- more first-time module transforms
// than any other single test file in this suite. Measured cold-start cost on
// a clean transform cache: ~46s wall / ~22s transform for the file, front-
// loaded onto whichever test happens to trigger a given module's first
// import; warm-cache reruns drop to ~7s/~1.4s. The default 5000ms per-test
// timeout is tuned for warm-cache runs and both failed only on this file's
// first cold invocation. Scoped to this file only, not the shared
// vitest.config.ts, since no other file in the suite needs it.
vi.setConfig({ testTimeout: 20000 });

const { runNavGatorCli } = vi.hoisted(() => ({ runNavGatorCli: vi.fn() }));

vi.mock("@/lib/server/navgator-cli", () => ({ runNavGatorCli }));
vi.mock("@/lib/server/project-path", async () => {
  return await import("../../web/lib/server/project-path.js");
});
vi.mock("@/lib/server/architecture-storage", async () => {
  return await import("../../web/lib/server/architecture-storage.js");
});
vi.mock("@/lib/server/request-guard", async () => {
  return await import("../../web/lib/server/request-guard.js");
});
vi.mock("@/lib/transform", async () => {
  return await import("../../web/lib/transform.js");
});

type JsonEnvelope = { success: boolean; error?: string; [key: string]: unknown };

async function readJson(res: { json(): Promise<unknown> }): Promise<JsonEnvelope> {
  return (await res.json()) as JsonEnvelope;
}

// ---------------------------------------------------------------------------
// Fake NextRequest-ish objects (same shape convention as
// web-registry-health-route.test.ts's fakeGetRequest/fakePostRequest).
// ---------------------------------------------------------------------------

function fakeGetRequest(params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  return {
    nextUrl: { searchParams, hostname: "localhost", protocol: "http:", host: "localhost:3000" },
    headers: { get: () => null },
  };
}

function fakePostRequest(jsonBody: unknown) {
  const headerEntries: Record<string, string> = {
    host: "localhost:3000",
    "content-type": "application/json",
    // Stand in for a request web/proxy.ts already validated, so
    // rejectUnsafeMutation's missing-Origin branch (SEC-001, exercised
    // elsewhere) doesn't fire here -- these tests target the SEC-007 path
    // guard, not the mutation trust boundary.
    //
    // This used to be a client-supplied `x-navgator-token`, which the guard
    // merely checked for presence. That was unsound and was reproduced
    // failing: a garbage token value made an Origin-less mutation MORE
    // privileged. The guard now reads a header only the proxy can produce.
    "x-navgator-proxy-verified": "1",
  };
  const all = new Map(Object.entries(headerEntries).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name: string) => all.get(name.toLowerCase()) ?? null },
    nextUrl: { hostname: "localhost", protocol: "http:", host: "localhost:3000" },
    json: () => Promise.resolve(jsonBody),
  };
}

// ---------------------------------------------------------------------------
// Traversal shapes. Computed from a static tmp-root prefix (never the actual
// registered/default dirs, which are only created in beforeAll -- an
// it.each() array argument is evaluated at suite-COLLECTION time, before any
// beforeAll hook runs).
// ---------------------------------------------------------------------------

function outsideRegistryVariants(): string[] {
  const nested = path.join(os.tmpdir(), "navgator-sec007-traversal-base", "nested", "deeper");
  return [
    `${nested}/../../../../etc`, // absolute + traversal
    `${nested}/../../../../etc/`, // trailing-slash variant of the same traversal
    "../../../../../../../../etc", // relative, symlink-ish form (no absolute prefix at all)
  ];
}

// ---------------------------------------------------------------------------
// Registry + tmp dirs. THREE distinct directories, because the allowlist has
// two accept paths and they must be tested apart:
//   registeredDir   -- in ~/.navgator/projects.json
//   defaultRootDir  -- the server's own launch root (NAVGATOR_PROJECT_PATH),
//                      NOT in the registry; accepted whether or not a caller
//                      names it explicitly
//   unregisteredDir -- neither; the rejection sample
// An earlier version of this file used one directory for both the default and
// the rejection sample. That made every 403 assertion pass for the wrong
// reason and would have hidden the trusted-default carve-out entirely, so keep
// these three separate.
// ---------------------------------------------------------------------------

let registeredDir: string;
let defaultRootDir: string;
let unregisteredDir: string;
let registryPath: string;
const tmpRoots: string[] = [];
let originalNavgatorProjectPath: string | undefined;

beforeAll(() => {
  registeredDir = fs.mkdtempSync(path.join(os.tmpdir(), "navgator-sec007-registered-"));
  tmpRoots.push(registeredDir);
  unregisteredDir = fs.mkdtempSync(path.join(os.tmpdir(), "navgator-sec007-unregistered-"));
  tmpRoots.push(unregisteredDir);
  defaultRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "navgator-sec007-defaultroot-"));
  tmpRoots.push(defaultRootDir);

  // Written under $HOME/.navgator/projects.json -- vitest's home-redirect
  // setupFiles hook (src/__tests__/setup/home-redirect.ts) has already
  // pointed $HOME at a per-test-file tmp dir by the time this module's
  // os.homedir() calls run, so this never touches a real registry.
  registryPath = path.join(os.homedir(), ".navgator", "projects.json");
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(
    registryPath,
    JSON.stringify({ projects: [{ path: registeredDir }], revision: 1 }),
  );

  originalNavgatorProjectPath = process.env.NAVGATOR_PROJECT_PATH;
  process.env.NAVGATOR_PROJECT_PATH = defaultRootDir;
});

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (originalNavgatorProjectPath === undefined) delete process.env.NAVGATOR_PROJECT_PATH;
  else process.env.NAVGATOR_PROJECT_PATH = originalNavgatorProjectPath;
});

beforeEach(() => {
  runNavGatorCli.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Table-driven GET routes. Every dashboard GET route that accepts a
// caller-supplied `path` belongs here -- a route added later that reads
// `searchParams.get("path")` directly instead of calling resolveProjectPath
// is exactly the omission this table exists to catch.
// ---------------------------------------------------------------------------

type RouteModule = { GET: (req: never) => Promise<{ status: number; json(): Promise<unknown> }> };

interface GetRouteCase {
  label: string;
  // A dynamic import() with a runtime-computed (non-literal) specifier does
  // NOT get vite's "resolve relative to the importing module" rewrite
  // applied, so it resolves against the wrong base and 404s. Each route
  // therefore gets its own literal import() call, wrapped in a loader
  // closure so the table stays declarative and the mistake (import(variable))
  // can't silently reappear.
  load: () => Promise<RouteModule>;
  extraParams?: Record<string, string>;
}

const GET_ROUTES: GetRouteCase[] = [
  { label: "GET /api/status", load: () => import("../../web/app/api/status/route.js") },
  { label: "GET /api/graph", load: () => import("../../web/app/api/graph/route.js") },
  { label: "GET /api/components", load: () => import("../../web/app/api/components/route.js") },
  { label: "GET /api/connections", load: () => import("../../web/app/api/connections/route.js") },
  { label: "GET /api/prompts", load: () => import("../../web/app/api/prompts/route.js") },
  { label: "GET /api/rules", load: () => import("../../web/app/api/rules/route.js") },
  {
    label: "GET /api/trace",
    load: () => import("../../web/app/api/trace/route.js"),
    extraParams: { component: "Web" }, // required param; guard runs after this check
  },
  { label: "GET /api/subgraph", load: () => import("../../web/app/api/subgraph/route.js") },
  { label: "GET /api/settings", load: () => import("../../web/app/api/settings/route.js") },
];

describe.each(GET_ROUTES)("$label (SEC-007 path guard)", ({ load, extraParams }) => {
  it("rejects an unregistered absolute path with 403 and never echoes it back", async () => {
    const { GET } = await load();
    const req = fakeGetRequest({ path: unregisteredDir, ...extraParams });
    const res = await GET(req as never);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain(unregisteredDir);
  });

  it("allows a registered path (200 / normal success shape)", async () => {
    const { GET } = await load();
    const req = fakeGetRequest({ path: registeredDir, ...extraParams });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
  });

  it("preserves default behavior with no `path` param, even though the server default isn't itself registered", async () => {
    const { GET } = await load();
    const req = fakeGetRequest({ ...extraParams });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
  });

  // The launch root must be reachable whether or not the caller names it.
  // Rejecting it only when passed explicitly would make the same project
  // available or not depending on an optional param, and it breaks the
  // dashboard's own Scan button, which posts `{ path: activeProject }` — often
  // the launch directory, which the user may never have added to the registry.
  // `defaultRootDir` is deliberately NOT in the registry, so this asserts the
  // trusted-default carve-out specifically; `unregisteredDir` is a third,
  // separate directory that stays rejected, which is what keeps this from
  // being an accidental hole in the allowlist.
  it("allows the server's own default root when named explicitly", async () => {
    const { GET } = await load();
    const req = fakeGetRequest({ path: defaultRootDir, ...extraParams });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
  });

  it.each(outsideRegistryVariants())(
    "rejects a traversal shape that resolves outside the registry: %s",
    async (candidate) => {
      const { GET } = await load();
      const req = fakeGetRequest({ path: candidate, ...extraParams });
      const res = await GET(req as never);
      expect(res.status).toBe(403);
      const body = await readJson(res);
      expect(JSON.stringify(body)).not.toContain(candidate);
    },
  );
});

// ---------------------------------------------------------------------------
// POST /api/scan -- the worse-in-kind case named in the finding: an
// unregistered path here doesn't just read, it would spawn the CLI with that
// directory as cwd, creating a `.navgator/` tree wherever it's pointed.
// ---------------------------------------------------------------------------

describe("POST /api/scan (SEC-007 path guard)", () => {
  it("rejects an unregistered path with 403 and never spawns the CLI", async () => {
    const { POST } = await import("../../web/app/api/scan/route.js");
    const req = fakePostRequest({ path: unregisteredDir });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(JSON.stringify(body)).not.toContain(unregisteredDir);
    expect(runNavGatorCli).not.toHaveBeenCalled();
  });

  it("allows a registered path and spawns the CLI with its resolved root as cwd", async () => {
    runNavGatorCli.mockResolvedValueOnce({
      stdout: JSON.stringify({ status: "noop" }),
      stderr: "",
    });
    const { POST } = await import("../../web/app/api/scan/route.js");
    const req = fakePostRequest({ path: registeredDir });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(runNavGatorCli).toHaveBeenCalledTimes(1);
    expect(runNavGatorCli.mock.calls[0]![1]).toBe(path.resolve(registeredDir));
  });
});

// ---------------------------------------------------------------------------
// POST /api/prompts -- also triggers a real CLI scan (runNavGatorScan), same
// class of risk as POST /api/scan. Not named in the original nine-GET-route
// finding but shares the exact `body.path` pattern, so it's covered here too.
// ---------------------------------------------------------------------------

describe("POST /api/prompts (SEC-007 path guard)", () => {
  it("rejects an unregistered path with 403 and never spawns the CLI", async () => {
    const { POST } = await import("../../web/app/api/prompts/route.js");
    const req = fakePostRequest({ path: unregisteredDir });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(runNavGatorCli).not.toHaveBeenCalled();
  });

  it("allows a registered path", async () => {
    runNavGatorCli.mockResolvedValueOnce({
      stdout: JSON.stringify({
        prompts: [],
        summary: { totalPrompts: 0, byProvider: {}, byCategory: {}, templatesCount: 0, withToolsCount: 0 },
        warnings: [],
      }),
      stderr: "",
    });
    const { POST } = await import("../../web/app/api/prompts/route.js");
    const req = fakePostRequest({ path: registeredDir });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(runNavGatorCli).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/settings -- a write primitive, not just a read: an unregistered
// `projectPath` would create `.navgator/settings.json` in an arbitrary
// directory. Uses a different body key (`projectPath`, not `path`) than
// every other route.
// ---------------------------------------------------------------------------

describe("POST /api/settings (SEC-007 path guard)", () => {
  it("rejects an unregistered projectPath with 403 and never writes", async () => {
    const { POST } = await import("../../web/app/api/settings/route.js");
    const req = fakePostRequest({ projectPath: unregisteredDir, display: { theme: "dark" } });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(JSON.stringify(body)).not.toContain(unregisteredDir);
    expect(fs.existsSync(path.join(unregisteredDir, ".navgator", "settings.json"))).toBe(false);
  });

  it("allows a registered projectPath and writes settings.json under it", async () => {
    const { POST } = await import("../../web/app/api/settings/route.js");
    const req = fakePostRequest({ projectPath: registeredDir, display: { theme: "light" } });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const written = JSON.parse(
      fs.readFileSync(path.join(registeredDir, ".navgator", "settings.json"), "utf-8"),
    );
    expect(written.display.theme).toBe("light");
  });
});
