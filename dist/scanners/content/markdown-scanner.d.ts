/**
 * Markdown content graph scanner.
 *
 * Models each Markdown file as a document component and extracts internal
 * Obsidian wikilinks, relative Markdown links, and typed frontmatter edges.
 * External URLs and links inside fenced/inline code are intentionally ignored.
 */
import { ScanResult } from '../../types.js';
/**
 * Scan a known Markdown file universe. `walkSet` limits connection origins for
 * incremental scans while all document components are returned so targets can
 * still resolve and prior connections can be remapped by stable_id.
 */
export declare function scanMarkdownContent(projectRoot: string, markdownFiles: string[], walkSet?: Set<string>): Promise<ScanResult>;
//# sourceMappingURL=markdown-scanner.d.ts.map