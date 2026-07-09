/**
 * Compatibility surface for freshness tests and callers.
 *
 * The implementation lives in `../scan-lock.ts`; the freshness drainer does
 * not acquire a second lease. `scan()` is the sole production lease owner.
 */
export { acquireScanLease, readScanLease, HEARTBEAT_INTERVAL_MS, LOCK_TTL_MS, } from '../scan-lock.js';
//# sourceMappingURL=scan-lock.js.map