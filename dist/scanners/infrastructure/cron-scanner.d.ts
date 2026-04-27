/**
 * Cron Job Scanner
 * Detects scheduled jobs from vercel.json crons, railway config, and crontab patterns
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for cron job definitions
 */
export declare function scanCronJobs(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult>;
/**
 * Detect if project has cron jobs
 */
export declare function detectCrons(projectRoot: string): boolean;
//# sourceMappingURL=cron-scanner.d.ts.map