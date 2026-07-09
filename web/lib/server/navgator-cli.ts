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

export async function runNavGatorCli(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cliEntry(), ...args], {
    cwd,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });
}
