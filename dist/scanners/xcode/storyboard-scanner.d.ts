/**
 * Storyboard and XIB Scanner
 * Detects view controllers and segues from Interface Builder files
 */
import { ArchitectureComponent, ArchitectureConnection } from '../../types.js';
/**
 * Scan all .storyboard and .xib files in the project
 */
export declare function scanStoryboards(projectRoot: string): Promise<{
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
}>;
//# sourceMappingURL=storyboard-scanner.d.ts.map