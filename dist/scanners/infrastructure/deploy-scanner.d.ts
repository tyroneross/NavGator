/**
 * Deployment Config Scanner
 * Parses vercel.json, railway.json/toml, Procfile, nixpacks.toml for deploy details
 */
import { ScanResult } from '../../types.js';
/**
 * Scan for deployment configuration details
 * This extends the basic infra detection with parsed config details
 */
export declare function scanDeployConfig(projectRoot: string): Promise<ScanResult>;
//# sourceMappingURL=deploy-scanner.d.ts.map