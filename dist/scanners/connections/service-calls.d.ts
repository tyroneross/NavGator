/**
 * Service Call Scanner
 * Detects connections to external services (Stripe, OpenAI, Claude, etc.)
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for service calls in the codebase
 */
export declare function scanServiceCalls(projectRoot: string, walkSet?: Set<string>): Promise<ScanResult>;
/**
 * Specifically scan for AI prompt locations
 */
export declare function scanPromptLocations(projectRoot: string): Promise<ScanResult>;
//# sourceMappingURL=service-calls.d.ts.map