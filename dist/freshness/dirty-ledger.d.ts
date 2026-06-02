/** Append paths to the dirty set (deduped, sorted). Safe to call concurrently-ish. */
export declare function markDirty(paths: string[], root: string): void;
/** Read the current dirty set (sorted). */
export declare function readDirty(root: string): string[];
/** Remove the given drained paths, leaving anything that arrived later. */
export declare function clearDirty(drained: string[], root: string): void;
//# sourceMappingURL=dirty-ledger.d.ts.map