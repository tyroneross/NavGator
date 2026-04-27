/**
 * LLM Use Case Deduplication
 *
 * Transforms raw LLM service-call connections (often 100+) into distinct
 * use cases (typically 5-15) by filtering noise and grouping by purpose.
 *
 * 3-layer pipeline:
 *   Layer 1 — Filter: remove test/dev, import-only, duplicates
 *   Layer 2 — Group: prompt match → function name → callType+model → file fallback
 *   Layer 3 — Merge: combine groups connected via import graph
 */
import type { ArchitectureComponent, ArchitectureConnection } from './types.js';
import type { DetectedPrompt } from './scanners/prompts/types.js';
export interface LLMUseCase {
    name: string;
    category?: string;
    provider: string;
    model?: string;
    primaryFile: string;
    callSites: number;
    productionCallSites: number;
    groupedBy: 'prompt' | 'function' | 'calltype' | 'file';
    /** Feature domain from features.yaml or directory inference */
    feature?: string;
    /** Downstream connections — what this LLM call feeds into (for agent classification) */
    feedsInto?: string[];
}
export interface LLMDedupResult {
    useCases: LLMUseCase[];
    totalCallSites: number;
    productionCallSites: number;
    providers: string[];
}
/**
 * Load feature annotations from .navgator/features.yaml if present.
 * Returns a map of file glob → feature name.
 */
export declare function loadFeatureAnnotations(projectRoot: string): Map<string, string> | null;
export declare function deduplicateLLMUseCases(components: ArchitectureComponent[], connections: ArchitectureConnection[], prompts?: DetectedPrompt[]): LLMDedupResult;
//# sourceMappingURL=llm-dedup.d.ts.map