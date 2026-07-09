export interface DirtyEventSnapshot {
    file: string;
    paths: string[];
}
export interface DirtyLedgerSnapshot {
    paths: string[];
    events: DirtyEventSnapshot[];
    legacyFingerprint?: string;
    legacyPaths: string[];
}
export interface DirtyLedgerTestHooks {
    afterEventList?: () => void;
    afterLegacyRead?: () => void;
    beforeSnapshotDelete?: () => void;
    beforeStampRename?: () => void;
}
/**
 * Serialize event mutations with publication of a clean freshness stamp.
 * Actions are deliberately synchronous so a same-process callback cannot run
 * while the mutex is held and deadlock attempting a nested mutation.
 */
export declare function withDirtyLedgerMutationLock<T>(root: string, action: () => T): T;
/** Capture an immutable event set; later events are excluded by filename. */
export declare function captureDirtySnapshot(root: string, hooks?: Pick<DirtyLedgerTestHooks, 'afterEventList' | 'afterLegacyRead'>): DirtyLedgerSnapshot;
/** Append one immutable event. Concurrent writers never share a temp path. */
export declare function markDirty(paths: string[], root: string, hooks?: Pick<DirtyLedgerTestHooks, 'beforeStampRename'>): void;
export declare function readDirty(root: string): string[];
/** Clear exactly the immutable events captured before a scan. */
export declare function clearDirtySnapshot(snapshot: DirtyLedgerSnapshot, root: string, hooks?: Pick<DirtyLedgerTestHooks, 'beforeSnapshotDelete'>): void;
/**
 * Compatibility helper: clear selected paths from events visible at call time.
 * New events created after the snapshot are never inspected or removed.
 */
export declare function clearDirty(drained: string[], root: string): void;
//# sourceMappingURL=dirty-ledger.d.ts.map