/**
 * Infrastructure Scanner
 * Detects deployment platforms, containers, and cloud services
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for infrastructure components
 */
export declare function scanInfrastructure(projectRoot: string): Promise<ScanResult>;
/**
 * Parse Docker Compose to find services
 */
export declare function parseDockerCompose(projectRoot: string): Promise<{
    services: string[];
}>;
/**
 * Parse Railway config for service info
 */
export declare function parseRailwayConfig(projectRoot: string): Promise<{
    build?: string;
    start?: string;
} | null>;
/**
 * Check for any infrastructure in the project
 */
export declare function hasInfrastructure(projectRoot: string): boolean;
//# sourceMappingURL=index.d.ts.map