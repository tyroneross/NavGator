/**
 * Check if NavGator data exists in the current directory or parent directories.
 * Traverses upward like git does to find the project root.
 * Returns a warning message if not found, or null if data exists.
 *
 * The upward walk stops at the git repository root. A `.navgator/` above that
 * root belongs to a DIFFERENT project, and adopting it would silently answer
 * questions about the wrong graph — the failure mode this guard exists to
 * prevent is an unscanned repo resolving to a home-directory-wide index.
 */
export declare function checkDataAvailability(): string | null;
//# sourceMappingURL=helpers.d.ts.map