/**
 * NavGator Setup & Initial Scan
 *
 * Provides a two-phase scanning approach:
 * 1. Fast scan: Quick package detection, basic file structure (instant feedback)
 * 2. Deep scan: Full AST analysis, connection detection, prompt scanning
 *
 * The fast scan uses lightweight regex patterns and file system analysis.
 * The deep scan uses ts-morph AST analysis for accurate detection.
 */
export interface SetupOptions {
    /** Project root path */
    projectPath?: string;
    /** Skip the deep scan phase */
    fastOnly?: boolean;
    /** Run deep scan immediately instead of in background */
    deepImmediate?: boolean;
    /** Generate initial diagram */
    generateDiagram?: boolean;
    /** Verbose output */
    verbose?: boolean;
    /** Callback for progress updates */
    onProgress?: (phase: string, message: string) => void;
}
export interface SetupResult {
    success: boolean;
    fastScanComplete: boolean;
    deepScanComplete: boolean;
    componentsFound: number;
    connectionsFound: number;
    promptsFound: number;
    diagram?: string;
    duration: {
        fastMs: number;
        deepMs?: number;
        totalMs: number;
    };
    errors: string[];
}
/**
 * Run initial NavGator setup with two-phase scanning
 */
export declare function setup(options?: SetupOptions): Promise<SetupResult>;
/**
 * Run fast scan only (for quick initial view)
 */
export declare function fastSetup(projectPath?: string): Promise<SetupResult>;
/**
 * Run full setup with both phases
 */
export declare function fullSetup(projectPath?: string): Promise<SetupResult>;
/**
 * Check if NavGator has been set up for a project
 */
export declare function isSetupComplete(projectPath?: string): Promise<{
    hasScanned: boolean;
    lastScan?: Date;
    phase?: 'fast' | 'deep';
    stale: boolean;
}>;
/**
 * Get setup status for display
 */
export declare function formatSetupStatus(result: SetupResult): string;
//# sourceMappingURL=setup.d.ts.map