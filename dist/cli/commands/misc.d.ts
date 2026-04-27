import { Command } from 'commander';
import { ChildProcess } from 'child_process';
export declare function launchWebUI(options: {
    port?: number;
    projectPath?: string;
}): Promise<{
    port: number;
    process: ChildProcess;
}>;
export declare function showWelcomeMenu(context: 'post-setup' | 'no-command'): Promise<void>;
export declare function registerSetupCommand(program: Command): void;
export declare function registerUICommand(program: Command): void;
export declare function registerHistoryCommand(program: Command): void;
export declare function registerDiffCommand(program: Command): void;
export declare function registerProjectsCommand(program: Command): void;
export declare function registerSummaryCommand(program: Command): void;
//# sourceMappingURL=misc.d.ts.map