import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execFileAsync = promisify(execFile);

function cliEntry(): string {
  const configured = process.env.NAVGATOR_CLI_ENTRY;
  const entry = configured || path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "dist",
    "cli",
    "index.js",
  );
  if (!path.isAbsolute(entry)) throw new Error("NAVGATOR_CLI_ENTRY must be an absolute path");
  return entry;
}

/**
 * The dashboard's own credentials, withheld from every CLI subprocess.
 *
 * `env: process.env` handed both secrets to `navgator scan` and to
 * everything scan itself spawns (SCIP indexer, git). None of them
 * authenticate to the dashboard, so none of them need the token; passing it
 * only widens the set of processes whose environment (`/proc/<pid>/environ`,
 * a crash dump, a debug log that prints `process.env`) discloses it.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const {
    NAVGATOR_DASHBOARD_TOKEN: _token,
    NAVGATOR_DASHBOARD_BOOTSTRAP: _bootstrap,
    ...rest
  } = process.env;
  return rest;
}

export async function runNavGatorCli(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cliEntry(), ...args], {
    cwd,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: cliEnv(),
  });
}
