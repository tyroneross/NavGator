/**
 * Queue Scanner
 * Detects BullMQ/Bull queues, workers, and producer-consumer relationships
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for queue definitions and create components/connections
 */
export declare function scanQueues(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult>;
/**
 * Detect if project uses any queue library
 */
export declare function detectQueues(projectRoot: string): boolean;
//# sourceMappingURL=queue-scanner.d.ts.map