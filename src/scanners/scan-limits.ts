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
 * Longest run of consecutive whitespace kept intact before collapsing.
 *
 * Not a taste threshold. The import clause is the only place the scanner's
 * regexes tolerate arbitrary interior whitespace, and a real clause separates
 * identifiers by a newline plus indentation — a handful of characters. 64 is
 * two orders of magnitude above that and still three orders below the run
 * length where backtracking becomes visible, so no real barrel import can
 * reach it and no pathological run can survive it.
 */
export const MAX_WHITESPACE_RUN = 64;

/**
 * Collapse absurd whitespace runs, which is what actually defeats the
 * backtracking.
 *
 * THE LENGTH CAP DOES NOT. A cap only removes inputs LONGER than the cap, so a
 * 4,000-character line sits under MAX_LINE_LENGTH and still reaches the engine.
 * Measured on `import` plus N spaces with the bounded `[\s\S]{0,4096}?` clause
 * already in place:
 *
 *     2,000 chars ->   4,311 ms
 *     4,000 chars ->  50,501 ms      <- under the 4,096 cap, still catastrophic
 *     8,000 chars -> 391,597 ms
 *
 * The unbounded clause it replaced cost 4,171 ms at 2,000 — statistically the
 * same — so bounding the quantifier bought nothing. Cost is quadratic in the
 * run length regardless of the bound, because with no closing quote the engine
 * retries every clause split at every start offset.
 *
 * WHAT THIS IS NOT. The obvious cheaper guard is to blank lines containing no
 * quote, since every specifier is quoted. It is wrong, and a test caught it: a
 * 120-name barrel import
 *
 *     import {
 *       exportedName0,          <- no quote on this line, or the 119 after it
 *     } from './target.js';
 *
 * loses its `import` keyword and the edge disappears. That trades a
 * denial-of-service for a SILENT MISSING EDGE, which is the worse direction for
 * an index whose job is blast radius — an agent that checks one file too many
 * wastes a minute, an agent that misses a dependent ships a break.
 *
 * Collapsing runs keeps every line, every quote, and every identifier, and
 * touches only whitespace no source file legitimately contains. Line COUNT is
 * preserved so reported line numbers stay correct: a collapsed run keeps one
 * newline per newline it swallowed.
 */
// Compiled once. This runs on every file of every scan, so building it per call
// cost enough across the suite to time tests out — the guard itself measured
// 0.5 ms on a 111 KB file, but the construction did not amortise.
const DEFAULT_RUN_RE = new RegExp(
  `[^\\S\\n]{${MAX_WHITESPACE_RUN + 1},}|\\n{${MAX_WHITESPACE_RUN + 1},}`,
  'g',
);

export function collapseWhitespaceRuns(
  content: string,
  maxRun: number = MAX_WHITESPACE_RUN,
): string {
  const pattern =
    maxRun === MAX_WHITESPACE_RUN
      ? DEFAULT_RUN_RE
      : new RegExp(`[^\\S\\n]{${maxRun + 1},}|\\n{${maxRun + 1},}`, 'g');
  pattern.lastIndex = 0;
  // Fast path: a run this long is absent from essentially every real source
  // file, and `test` bails at the first match instead of building a result
  // string. Scans are dominated by files that need no rewriting at all.
  if (!pattern.test(content)) return content;
  pattern.lastIndex = 0;
  return content.replace(pattern, match =>
    // Horizontal runs collapse to one space. A newline run collapses to maxRun
    // newlines rather than one, because line NUMBERS are reported downstream
    // and collapsing them to a single break would shift every line after it.
    match.charCodeAt(0) === 10 ? '\n'.repeat(maxRun) : ' ',
  );
}

/**
 * Blank every line longer than `MAX_LINE_LENGTH`, preserving the line COUNT so
 * reported line numbers stay correct. Minified bundles and single-line data
 * blobs are the pathological input for every regex in the scanner set, and
 * they never carry architecture worth indexing.
 */
export function capLongLines(content: string, maxLineLength: number = MAX_LINE_LENGTH): string {
  // Fast path: most files have no long line at all, so avoid the split/join.
  if (content.length <= maxLineLength) return content;
  let needsCapping = false;
  for (const line of content.split('\n')) {
    if (line.length > maxLineLength) {
      needsCapping = true;
      break;
    }
  }
  if (!needsCapping) return content;
  return content
    .split('\n')
    .map(line => (line.length > maxLineLength ? '' : line))
    .join('\n');
}
