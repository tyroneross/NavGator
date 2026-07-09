/**
 * Compatibility surface for freshness tests and callers.
 *
 * The implementation lives in `../scan-lock.ts`; the freshness drainer does
 * not acquire a second lease. `scan()` is the sole production lease owner.
 */
export {
  acquireScanLease,
  readScanLease,
  HEARTBEAT_INTERVAL_MS,
  LOCK_TTL_MS,
  type ScanLease,
  type ScanLeaseOptions,
  type ScanLeaseRecord,
  type ScanLeaseResult,
} from '../scan-lock.js';
