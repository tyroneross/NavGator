/** The `.navgator` base dir for a project root (sibling of `architecture/`). */
export declare function navgatorBase(root: string): string;
/** Dirty-set ledger: append-only set of changed paths since the last clean drain. */
export declare function dirtyLedgerPath(root: string): string;
/** Immutable per-mutation events used by the concurrency-safe dirty ledger. */
export declare function dirtyEventsPath(root: string): string;
/** Short-lived mutex for ledger mutation and clean-stamp publication. */
export declare function dirtyMutationLockPath(root: string): string;
/** Single-writer scan lock. */
export declare function scanLockPath(root: string): string;
/** Freshness stamp, stored next to the graph it describes. */
export declare function stampPath(root: string): string;
//# sourceMappingURL=paths.d.ts.map