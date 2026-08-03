import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistryHealthReport } from "../../web/lib/types.js";

// SEC-004 / G5: /api/registry-health backs the dashboard's registry-hygiene
// panel and its one destructive action (prune-tmp). Like web-coverage-route
// (see the comment block there for the full explanation), route.ts imports
// "@/lib/server/request-guard", "@/lib/server/navgator-cli", and "@/lib/types"
// via bundler-only alias resolution that vitest's `src` project has no path
// mapping for, so those bare specifiers can't resolve on their own.
//
// Unlike the coverage route test, this route's own gating logic (the confirm
// body check, the argv it shells out with, the schema_version compatibility
// check, and the exact failure-message text) all live inline in route.ts and
// are not exported, so testing them means importing route.ts itself rather
// than re-testing an extracted helper module. `vi.mock` intercepts import
// specifiers as written (it does not require the bare specifier to resolve on
// its own), so route.ts's `@/lib/*` imports can be redirected: real
// request-guard.ts is loaded via a relative path (exercising the genuine
// loopback/mutation guard, matching the pattern already used for those guards
// in web-coverage-route.test.ts), while navgator-cli.ts's `runNavGatorCli` is
// fully mocked per the task's requirement not to spawn a real process or
// touch the real registry. `next/server`'s NextResponse resolves fine because
// resolution follows route.ts's own on-disk location under web/, which does
// have `next` hoisted into web/node_modules.
const { runNavGatorCli } = vi.hoisted(() => ({ runNavGatorCli: vi.fn() }));

vi.mock("@/lib/server/navgator-cli", () => ({ runNavGatorCli }));
vi.mock("@/lib/server/request-guard", async () => {
  return await import("../../web/lib/server/request-guard.js");
});

const UNAVAILABLE_MESSAGE = "Registry health unavailable. Rebuild the CLI with `npm run build`.";

function incompatibleMessage(schemaVersion: string): string {
  return `Registry health data is from an incompatible CLI version (got ${schemaVersion}). Rebuild the CLI with \`npm run build\`.`;
}

// NextResponse#json() types its return as `unknown` (correctly — it can't
// know the runtime shape without a generic). Tests that only need deep-equal
// comparison (`expect(body).toEqual(...)`) don't need this; tests that reach
// into fields (`body.data.cleanup`) do, since TS won't allow property access
// on `unknown` without narrowing first.
type JsonEnvelope = { success: boolean; error?: string; data?: Record<string, unknown> };
async function readJson(res: { json(): Promise<unknown> }): Promise<JsonEnvelope> {
  return (await res.json()) as JsonEnvelope;
}

type FakeHeaders = Record<string, string>;

function fakeGetRequest(host: string, headers: FakeHeaders = {}) {
  const all = new Map<string, string>(
    Object.entries({ host, ...headers }).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: { get: (name: string) => all.get(name.toLowerCase()) ?? null },
    nextUrl: { hostname: host.split(":")[0], protocol: "http:", host },
  };
}

function fakePostRequest(
  jsonBody: () => Promise<unknown>,
  opts: { host?: string; contentType?: string | null; headers?: FakeHeaders } = {},
) {
  const host = opts.host ?? "localhost:3000";
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  const headerEntries: FakeHeaders = { host, ...(opts.headers ?? {}) };
  if (contentType !== null) headerEntries["content-type"] = contentType;
  const all = new Map<string, string>(Object.entries(headerEntries).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name: string) => all.get(name.toLowerCase()) ?? null },
    nextUrl: { hostname: host.split(":")[0], protocol: "http:", host },
    json: jsonBody,
  };
}

function healthyReport(overrides: Partial<RegistryHealthReport> = {}): RegistryHealthReport {
  return {
    schema_version: "1.1.0",
    registry: { path: "/fake/projects.json", entries: 2, revision: 4, bytes: 512, tmpRooted: 0, missing: 0, prunable: 0 },
    journal: {
      records: 10,
      windowDays: 7,
      registersInWindow: 3,
      registersPerDay: 0.43,
      estimated: false,
      insufficientWindow: false,
      conflicts: 0,
      degradedWrites: 0,
    },
    memory: { exists: true, projects: 2, orphaned: 0, events: 5, bytes: 1024, lastEventAt: 1700000000000 },
    mirror: { enabled: false, target: null, targetExists: false },
    findings: [],
    verdict: "healthy",
    ...overrides,
  };
}

describe("registry-health route (G5 dashboard hygiene surface)", () => {
  beforeEach(() => {
    runNavGatorCli.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- Case 1: loopback guard on GET -------------------------------------
  it("rejects a GET from a non-loopback origin without invoking the CLI", async () => {
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("evil.example.com") as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "Dashboard requests must use a loopback hostname" });
    expect(runNavGatorCli).not.toHaveBeenCalled();
  });

  it("allows a GET from a loopback origin (control for case 1)", async () => {
    runNavGatorCli.mockResolvedValueOnce({ stdout: JSON.stringify(healthyReport()), stderr: "" });
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("localhost:3000") as never);
    expect(res.status).toBe(200);
    expect(runNavGatorCli).toHaveBeenCalledTimes(1);
  });

  // --- Case 2: confirm-body gate on POST ----------------------------------
  const confirmGateMessage =
    'Cleanup requires a confirmed request body: { "action": "prune-tmp", "confirm": true }';

  it.each([
    ["no body (json() resolves null)", () => Promise.resolve(null)],
    ["action present, confirm missing", () => Promise.resolve({ action: "prune-tmp" })],
    ["confirm is the string 'true', not boolean true", () => Promise.resolve({ action: "prune-tmp", confirm: "true" })],
    // Distinguishes strict !== from a loosely-relaxed != mutation: `1 == true`
    // is true under loose equality (booleans coerce to numbers, not the other
    // way around), so a `confirm !== true` -> `confirm != true` regression
    // would silently accept this and invoke the CLI. The 'true' string case
    // above does NOT catch that regression ("true" == true is false in JS,
    // the reverse of what the string spelling suggests), so both near-misses
    // are needed to pin the strict check.
    ["confirm is the number 1, not boolean true", () => Promise.resolve({ action: "prune-tmp", confirm: 1 })],
    ["wrong action", () => Promise.resolve({ action: "prune-something-else", confirm: true })],
  ])("rejects POST 400 when %s", async (_label, jsonBody) => {
    const { POST } = await import("../../web/app/api/registry-health/route.js");
    const res = await POST(fakePostRequest(jsonBody) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: confirmGateMessage });
    expect(runNavGatorCli).not.toHaveBeenCalled();
  });

  it("rejects POST 400 when the request body is not valid JSON at all", async () => {
    const { POST } = await import("../../web/app/api/registry-health/route.js");
    const res = await POST(
      fakePostRequest(() => Promise.reject(new SyntaxError("Unexpected end of JSON input"))) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "Request body must be JSON" });
    expect(runNavGatorCli).not.toHaveBeenCalled();
  });

  // --- Case 3: correct body reaches the CLI invocation --------------------
  it("shells out with the expected argv when the body is correctly confirmed", async () => {
    runNavGatorCli.mockResolvedValueOnce({
      stdout: JSON.stringify(
        healthyReport({}) as RegistryHealthReport & {
          cleanup: { backupPath: string; removedFromRegistry: number; removedFromMemory: number };
        },
      ).replace(
        /}$/,
        `,"cleanup":${JSON.stringify({ backupPath: "/fake/backups/x.json", removedFromRegistry: 1, removedFromMemory: 0 })}}`,
      ),
      stderr: "",
    });
    const { POST } = await import("../../web/app/api/registry-health/route.js");
    const res = await POST(
      fakePostRequest(() => Promise.resolve({ action: "prune-tmp", confirm: true })) as never,
    );
    expect(runNavGatorCli).toHaveBeenCalledTimes(1);
    expect(runNavGatorCli).toHaveBeenCalledWith(
      ["doctor", "--fix", "--yes", "--json"],
      process.cwd(),
      15000,
    );
    const body = await readJson(res);
    expect(body.success).toBe(true);
    expect(body.data?.cleanup).toEqual({ backupPath: "/fake/backups/x.json", removedFromRegistry: 1, removedFromMemory: 0 });
  });

  it("does NOT let the prune actually run — the boundary is the mock, never a real process", async () => {
    // Explicit negative control for the "not that prune actually happened"
    // requirement: the only thing that produced this response is the mock.
    runNavGatorCli.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ...healthyReport(),
        cleanup: { backupPath: "/fake/backups/y.json", removedFromRegistry: 0, removedFromMemory: 0 },
      }),
      stderr: "",
    });
    const { POST } = await import("../../web/app/api/registry-health/route.js");
    await POST(fakePostRequest(() => Promise.resolve({ action: "prune-tmp", confirm: true })) as never);
    expect(runNavGatorCli.mock.calls[0]![0]).not.toContain("--dry-run"); // sanity: real destructive argv, but never executed
    expect(runNavGatorCli).toHaveBeenCalledTimes(1); // exactly the mock, not a real spawn plus a real one
  });

  // --- Case 4: unparseable stdout ------------------------------------------
  it("returns the actionable rebuild message (not zeros/empty) when stdout is unparseable", async () => {
    runNavGatorCli.mockResolvedValueOnce({ stdout: "this is not json", stderr: "" });
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("localhost:3000") as never);
    const body = await readJson(res);
    expect(body).toEqual({ success: false, error: UNAVAILABLE_MESSAGE });
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/"entries":0/);
  });

  // --- Case 5: non-zero exit / spawn rejection ----------------------------
  it("returns the same actionable message when the CLI process rejects (non-zero exit / spawn failure)", async () => {
    runNavGatorCli.mockRejectedValueOnce(Object.assign(new Error("Command failed"), { code: 1 }));
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("localhost:3000") as never);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: UNAVAILABLE_MESSAGE });
  });

  it("returns the same actionable message on POST when the CLI process rejects", async () => {
    runNavGatorCli.mockRejectedValueOnce(new Error("ENOENT: spawn failed"));
    const { POST } = await import("../../web/app/api/registry-health/route.js");
    const res = await POST(
      fakePostRequest(() => Promise.resolve({ action: "prune-tmp", confirm: true })) as never,
    );
    const body = await res.json();
    expect(body).toEqual({ success: false, error: UNAVAILABLE_MESSAGE });
  });

  // --- Case 6: schema_version compatibility --------------------------------
  it("rejects a MAJOR schema_version mismatch (2.0.0) with the incompatible-version message", async () => {
    runNavGatorCli.mockResolvedValueOnce({
      stdout: JSON.stringify(healthyReport({ schema_version: "2.0.0" })),
      stderr: "",
    });
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("localhost:3000") as never);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: incompatibleMessage("2.0.0") });
  });

  it("ACCEPTS a minor-version bump (1.1.0) — only a major mismatch is incompatible", async () => {
    runNavGatorCli.mockResolvedValueOnce({
      stdout: JSON.stringify(healthyReport({ schema_version: "1.1.0" })),
      stderr: "",
    });
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("localhost:3000") as never);
    const body = await readJson(res);
    expect(body.success).toBe(true);
    expect(body.data?.schema_version).toBe("1.1.0");
  });

  // --- Case 7: well-formed GET returns the report unchanged ----------------
  it("returns a well-formed GET report unchanged under the {success, data, error} envelope", async () => {
    const report = healthyReport({
      registry: { path: "/fake/projects.json", entries: 3, revision: 7, bytes: 900, tmpRooted: 1, missing: 0, prunable: 1 },
      findings: [{ severity: "warn", code: "tmp-rooted", message: "1 entry points into a tmp directory" }],
      verdict: "attention",
    });
    runNavGatorCli.mockResolvedValueOnce({ stdout: JSON.stringify(report), stderr: "" });
    const { GET } = await import("../../web/app/api/registry-health/route.js");
    const res = await GET(fakeGetRequest("localhost:3000") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: report });
  });
});
