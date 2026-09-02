/**
 * Resource-exhaustion caps shared by every scanner (SEC-012).
 *
 * A repo reached via `navgator scan-remote` controls its own file contents, so
 * scanner input is untrusted by construction. Without caps a single huge or
 * single-line file hangs or OOMs the scan. These constants started life inside
 * `llm-call-tracer.ts`; they live here so a second scanner cannot silently ship
 * without them, which is exactly what happened to `import-scanner.ts` (measured
 * on one 8,000-character line: 88 seconds, with no line cap applied at all).
 */
/** Files larger than this are skipped entirely. */
export declare const MAX_FILE_SIZE_BYTES = 1048576;
/** Lines longer than this are blanked before any regex runs. */
export declare const MAX_LINE_LENGTH = 4096;
/**
 * Longest run of consecutive whitespace kept intact before collapsing.
 *
 * Not a taste threshold. The import clause is the only place the scanner's
 * regexes tolerate arbitrary interior whitespace, and a real clause separates
 * identifiers by a newline plus indentation — a handful of characters. 64 is
 * two orders of magnitude above that and still three orders below the run
 * length where backtracking becomes visible, so no real barrel import can
 * reach it and no pathological run can survive it.
 */
export declare const MAX_WHITESPACE_RUN = 64;
export declare function collapseWhitespaceRuns(content: string, maxRun?: number): string;
/**
 * Blank every line longer than `MAX_LINE_LENGTH`, preserving the line COUNT so
 * reported line numbers stay correct. Minified bundles and single-line data
 * blobs are the pathological input for every regex in the scanner set, and
 * they never carry architecture worth indexing.
 */
export declare function capLongLines(content: string, maxLineLength?: number): string;
//# sourceMappingURL=scan-limits.d.ts.map