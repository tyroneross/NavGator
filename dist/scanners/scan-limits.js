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
export const MAX_FILE_SIZE_BYTES = 1_048_576; // 1 MiB
/** Lines longer than this are blanked before any regex runs. */
export const MAX_LINE_LENGTH = 4_096;
/**
 * Blank every line longer than `MAX_LINE_LENGTH`, preserving the line COUNT so
 * reported line numbers stay correct. Minified bundles and single-line data
 * blobs are the pathological input for every regex in the scanner set, and
 * they never carry architecture worth indexing.
 */
export function capLongLines(content, maxLineLength = MAX_LINE_LENGTH) {
    // Fast path: most files have no long line at all, so avoid the split/join.
    if (content.length <= maxLineLength)
        return content;
    let needsCapping = false;
    for (const line of content.split('\n')) {
        if (line.length > maxLineLength) {
            needsCapping = true;
            break;
        }
    }
    if (!needsCapping)
        return content;
    return content
        .split('\n')
        .map(line => (line.length > maxLineLength ? '' : line))
        .join('\n');
}
//# sourceMappingURL=scan-limits.js.map