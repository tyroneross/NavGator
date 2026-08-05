/**
 * Per-session capability token for the NavGator dashboard (SEC-001).
 *
 * `web/proxy.ts` already rejects any request whose `Host` header does not
 * resolve to a loopback hostname — that stays in place as the DNS-rebinding
 * defense (a browser can't forge `Host`, but it CAN be tricked into
 * resolving an attacker-controlled page to 127.0.0.1). What loopback alone
 * does NOT defend against is another LOCAL process — any other program
 * running as the same or a different user on the machine can send a
 * well-formed `Host: 127.0.0.1:<port>` request and read or mutate the
 * dashboard with no further check.
 *
 * This module mints a random, per-launch bearer token, persists it to a
 * 0600 file only the invoking user can read, and hands it to the spawned
 * dashboard server via env var. `web/proxy.ts` then requires that token
 * (via cookie after a one-time bootstrap redirect, or via header for
 * scripted/CLI local clients) on top of the loopback check.
 *
 * Home-directory resolution deliberately matches `homeConfigPath()` in
 * `src/home-config.ts`: `os.homedir()` resolved PER CALL, not cached in a
 * module-level const, so the suite-wide `$HOME` redirect
 * (`src/__tests__/setup/home-redirect.ts`) reaches this module the same way
 * it reaches every other `~/.navgator/*` writer in this tree.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// =============================================================================
// TYPES
// =============================================================================

export interface DashboardSessionRecord {
  token: string;
  port: number;
  pid: number;
  created_at: number;
}

// =============================================================================
// PATH
// =============================================================================

/** Resolved per call — see the file header for why this can't be a const. */
export function dashboardSessionPath(): string {
  return path.join(os.homedir(), '.navgator', 'dashboard-session.json');
}

// =============================================================================
// MINT / WRITE / READ
// =============================================================================

/** 32 bytes of `crypto.randomBytes`, hex-encoded (64 hex chars). */
export function mintDashboardToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Persist the session record at 0600. `fs.writeFileSync`'s `mode` option
 * only applies when the file is CREATED — if `dashboard-session.json`
 * already exists from a prior launch, an overwriting write keeps that
 * file's existing mode. The explicit `chmodSync` afterward is what makes
 * 0600 hold on every launch, not just the first.
 */
export function writeDashboardSession(token: string, port: number): void {
  const filePath = dashboardSessionPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });

  const record: DashboardSessionRecord = {
    token,
    port,
    pid: process.pid,
    created_at: Date.now(),
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function isDashboardSessionRecord(value: unknown): value is DashboardSessionRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).token === 'string' &&
    typeof (value as Record<string, unknown>).port === 'number' &&
    typeof (value as Record<string, unknown>).pid === 'number' &&
    typeof (value as Record<string, unknown>).created_at === 'number'
  );
}

/**
 * Read back the session record, or `null` if the file is absent or
 * malformed. Fail-open on read, mirroring every other `~/.navgator/*`
 * loader in this tree (`loadHomeConfig()`, `readJournal()`) — a broken or
 * missing session file must never throw for a caller just checking whether
 * one exists.
 */
export function readDashboardSession(): DashboardSessionRecord | null {
  try {
    const raw = fs.readFileSync(dashboardSessionPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return isDashboardSessionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
