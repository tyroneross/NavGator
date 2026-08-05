/**
 * Shared caller-supplied `path` validation for dashboard GET/POST routes.
 *
 * SEC-007: /api/coverage validated its `path` query param against the
 * registered-project allowlist (isRegisteredProjectPath, coverage.ts); the
 * nine sibling routes did not, so a caller could point status/graph/
 * components/connections/prompts/rules/trace/subgraph/settings/scan at an
 * arbitrary absolute directory -- reading `<path>/.navgator/architecture/*`
 * from anywhere on the machine, using success-vs-error as a directory
 * existence oracle, and (for POST /api/scan) writing a `.navgator/` tree
 * into an arbitrary cwd. This module hoists the validation into one place so
 * a route that forgets to call it is visible in review: every route below
 * should read `resolveProjectPath(searchParams)` / `resolveProjectPathFromBody`
 * rather than `searchParams.get("path")` / `body.path` directly. A route that
 * does the latter is exactly the pattern that let this drift in the first
 * place.
 *
 * Deliberately alias-free (only fs/path/os plus the coverage.ts allowlist
 * reader and next/server's NextResponse) so this stays importable the same
 * way coverage.ts already is from src/__tests__ -- see
 * src/__tests__/web-coverage-route.test.ts.
 */

import * as os from "os";
import * as path from "path";
import { NextResponse } from "next/server";
import { isRegisteredProjectPath } from "./coverage";

/** ~/.navgator/projects.json -- the same allowlist isRegisteredProjectPath already reads. */
export const DEFAULT_PROJECT_REGISTRY_PATH = path.join(os.homedir(), ".navgator", "projects.json");

/** The server's own default project root when no `path` param is supplied. */
export function defaultProjectRoot(): string {
  // The `/web` strip yields "" when cwd is exactly "/web", which would hand
  // routes an empty root; fall back to cwd in that case.
  return process.env.NAVGATOR_PROJECT_PATH || process.cwd().replace(/\/web$/, "") || process.cwd();
}

export type ResolvedProjectPath = { root: string };

const REJECTED_PATH_MESSAGE = "path must match a registered NavGator project";

/**
 * Validate a single caller-supplied `path` value.
 *
 * - Falsy/absent -> the server default (never rejected; this is the hot
 *   path for most dashboard traffic).
 * - Present but not a registered project (after path.resolve normalization,
 *   so `..` traversal and trailing-slash variants can't dodge the allowlist
 *   comparison) -> a ready-to-return 403 NextResponse. The rejected value is
 *   deliberately never echoed back -- doing so would turn the guard itself
 *   into a directory-existence oracle.
 * - Present and registered -> the normalized, resolved absolute path.
 */
function resolveProjectPathValue(
  rawPath: string | null | undefined,
  registryPath: string,
): ResolvedProjectPath | NextResponse {
  if (!rawPath) {
    // Resolved, not raw. The explicit branch below returns path.resolve(...),
    // so returning the raw value here would hand routes two different strings
    // for one directory whenever NAVGATOR_PROJECT_PATH needs normalizing
    // (a trailing slash, an embedded `..`). Per-route caches key on that
    // string and coverage.ts computes path.relative against it, so the two
    // spellings must not diverge.
    return { root: path.resolve(defaultProjectRoot()) };
  }

  const resolved = path.resolve(rawPath);

  // The server's own default root is trusted by definition -- it is whatever
  // `navgator ui` was launched against -- and the branch above already serves
  // it when the param is absent. Rejecting it when a caller names it
  // EXPLICITLY would make the same project reachable or not depending on
  // whether an optional param was sent, which is incoherent as a rule and
  // breaks a real flow: the dashboard's own Scan button posts
  // `{ path: activeProject }` (web/components/header.tsx), and the active
  // project is frequently the launch directory, which the user may never have
  // added to the registry. So the allowlist is registered-projects PLUS the
  // launch root -- not a widening of the boundary, since an attacker who could
  // choose that value would already be choosing the server's own configuration.
  //
  // Comparison is exact string equality on the resolved path, so on a
  // case-insensitive filesystem a case variant of a genuinely registered
  // project (`/Users/x/Dev/Proj` against a registry entry of
  // `/Users/x/dev/Proj`) is REJECTED even though both name the same directory.
  // That is the safe direction and it stays: case-folding would widen the
  // boundary. If this ever surfaces as a confusing 403 in practice, compare
  // fs.realpathSync.native() of both sides rather than lowercasing.
  if (resolved !== path.resolve(defaultProjectRoot()) && !isRegisteredProjectPath(resolved, registryPath)) {
    return NextResponse.json(
      { success: false, error: REJECTED_PATH_MESSAGE },
      { status: 403 },
    );
  }

  return { root: resolved };
}

/**
 * Validate the `path` query param off a GET request's searchParams.
 * Call sites: `const resolved = resolveProjectPath(searchParams);
 * if (resolved instanceof NextResponse) return resolved;`
 */
export function resolveProjectPath(
  searchParams: URLSearchParams,
  registryPath: string = DEFAULT_PROJECT_REGISTRY_PATH,
): ResolvedProjectPath | NextResponse {
  return resolveProjectPathValue(searchParams.get("path"), registryPath);
}

/**
 * Validate a `path`-shaped value off a parsed POST body. Body key names vary
 * per route (`body.path` on /api/prompts and /api/scan, `body.projectPath`
 * on /api/settings) so callers pass the already-extracted value rather than
 * the whole body.
 */
export function resolveProjectPathFromBody(
  rawValue: unknown,
  registryPath: string = DEFAULT_PROJECT_REGISTRY_PATH,
): ResolvedProjectPath | NextResponse {
  return resolveProjectPathValue(typeof rawValue === "string" ? rawValue : null, registryPath);
}
