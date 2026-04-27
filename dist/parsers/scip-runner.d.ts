/**
 * SCIP runner (Wave 2 T10).
 *
 * Shells out to scip-typescript, parses the resulting index.scip protobuf,
 * and surfaces RESOLVED cross-file edges — what tsserver actually sees,
 * not what regex guesses.
 *
 * Performance:
 *   - First run (cold cache): 400-1500ms on small repos. Always slower than
 *     the regex import-scanner.
 *   - Subsequent runs: scip-typescript has no cache; same cost.
 *   - This is why SCIP is opt-in (--scip flag / NAVGATOR_SCIP=1) — it buys
 *     accuracy at the cost of throughput.
 */
export interface ScipEdge {
    /** Source file the reference appears in (relative to projectRoot). */
    from_file: string;
    /** Line where the reference is (0-indexed; SCIP convention). */
    from_line: number;
    /** SCIP symbol identifier — fully qualified, e.g.
     *  `scip-typescript npm bench-fixture 0.0.0 src/`db.ts`/Foo#`. */
    symbol: string;
    /** Whether this occurrence is a definition (1) or a reference (0). */
    is_definition: boolean;
    /** Best-guess "to_file" if the symbol's document is in this index. */
    to_file?: string;
    /** Display name from the symbol's SymbolInformation, when present. */
    display_name?: string;
}
export interface ScipResult {
    ok: boolean;
    edges: ScipEdge[];
    documents_indexed: number;
    duration_ms: number;
    error?: string;
    cwd: string;
}
/**
 * Returns true if the project has a tsconfig.json (or jsconfig.json) at root.
 * scip-typescript needs one — `--infer-tsconfig` works but balloons cold time.
 */
export declare function hasTsConfig(projectRoot: string): boolean;
/**
 * Index a project with scip-typescript and parse the resulting protobuf.
 * Returns the cross-file edges plus minimal metadata.
 *
 * Assumptions:
 *   - projectRoot has a tsconfig.json (call hasTsConfig() first or pass
 *     `inferTsconfig: true` to let scip-typescript guess).
 *   - The output file is written to a unique tmp path and cleaned up.
 */
export declare function runScip(projectRoot: string, options?: {
    inferTsconfig?: boolean;
    maxFileBytes?: string;
    timeoutMs?: number;
}): Promise<ScipResult>;
/**
 * Filter edges to cross-file references only — these are what callers
 * typically want for "what does file X import / call from?". Drops
 * definitions and same-file references.
 */
export declare function crossFileEdges(edges: ScipEdge[]): ScipEdge[];
//# sourceMappingURL=scip-runner.d.ts.map