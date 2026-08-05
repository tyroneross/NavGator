import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
/**
 * Open a URL in the user's browser WITHOUT going through a shell.
 *
 * The previous form was `exec(`${openCmd} ${url}`)`, which does two bad
 * things at once: it interposes a `/bin/sh -c <whole command line>` process
 * whose argv is a second copy of the URL in the process table, and it leaves
 * the unquoted `?` and `&` in the URL exposed to shell globbing and job
 * control. An argv array goes straight to `execvp` — no shell, no second
 * copy, no quoting to get wrong.
 *
 * This is hygiene, not the control. What actually keeps a `ps`-reading
 * attacker from getting a usable credential is that the value in this URL is
 * a single-use, short-TTL nonce rather than the session token (see
 * `src/dashboard-session.ts`). `spawn` alone would still print the URL in
 * the child's own argv.
 *
 * `start` on Windows is a `cmd.exe` builtin rather than an executable, so it
 * cannot be `spawn`ed directly; `cmd /c start ""` is the argv-array
 * equivalent (the empty string is the window title `start` otherwise steals
 * from the first quoted argument).
 */
export declare function browserOpenArgv(url: string, platform?: NodeJS.Platform): {
    command: string;
    args: string[];
};
/**
 * `spawnFn` is injectable so a test can assert on the EXACT argv without
 * launching a browser. The default is the real `spawn`; no production call
 * site passes anything.
 */
export declare function openInBrowser(url: string, spawnFn?: typeof spawn): void;
/**
 * The one place the browser-open URL is built.
 *
 * Both `navgator ui` call sites go through this, so there is exactly one
 * line to audit for "does a secret that must not enter an argv end up in an
 * argv". It takes the NONCE, and there is no parameter it could accept the
 * session token through.
 */
export declare function bootstrapUrl(port: number, bootstrapNonce: string): string;
export declare function launchWebUI(options: {
    port?: number;
    projectPath?: string;
}): Promise<{
    port: number;
    process: ChildProcess;
    token: string;
    bootstrapNonce: string;
    /**
     * The exact string handed to the browser-open call. Returned so a live
     * verifier can assert on the value that becomes an argv, rather than on a
     * reconstruction of it.
     */
    bootstrapUrl: string;
}>;
export declare function showWelcomeMenu(context: 'post-setup' | 'no-command'): Promise<void>;
export declare function registerSetupCommand(program: Command): void;
export declare function registerUICommand(program: Command): void;
export declare function registerHistoryCommand(program: Command): void;
export declare function registerDiffCommand(program: Command): void;
export declare function registerProjectsCommand(program: Command): void;
export declare function registerRegistryLogCommand(program: Command): void;
export declare function registerSummaryCommand(program: Command): void;
//# sourceMappingURL=misc.d.ts.map