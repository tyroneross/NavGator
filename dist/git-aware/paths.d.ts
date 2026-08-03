/** `<architecture-base>/canonical/snapshot.json` — the committed baseline. */
export declare function canonicalSnapshotPath(root: string): string;
/** `<architecture-base>/branches` — parent dir for one subdir per branch/ref slug. */
export declare function branchSnapshotDir(root: string): string;
/** `<architecture-base>/branches/<slug>/snapshot.json` — the local delta side. */
export declare function branchSnapshotPath(root: string, slug: string): string;
//# sourceMappingURL=paths.d.ts.map