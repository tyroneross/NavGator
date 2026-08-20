/**
 * NavGator Component Identity
 * Base-name normalization and alias merging, extracted from cli/commands/list.ts
 * so resolveComponent() and other callers can share the same identity rules.
 */
import { type ArchitectureComponent } from './types.js';
/**
 * Normalize a component name to its base identity string.
 * Applies the same three normalizations as list.ts:55-59:
 * - Strip "Config" and everything after it
 * - Strip a trailing parenthetical
 * - Strip a trailing @scope/version
 * Result is trimmed and lowercased.
 *
 * Examples: "Railway Config" / "Railway (infra)" / "Railway" → "railway"
 *           "bullmq@5.61.0" / "BullMQ" → "bullmq"
 */
export declare function componentBaseName(name: string): string;
/**
 * Build the merge/identity key for a component: base name + type.
 * Components of different types never share an identity, even with the same base name.
 */
export declare function identityKey(c: Pick<ArchitectureComponent, 'name' | 'type' | 'stable_id'>): string;
/**
 * Merge components that share an identity key (same base name + type), keeping
 * the one with more connections (connects_to + connected_from), matching the
 * keep-the-one-with-more-connections rule at list.ts:64-71.
 */
export declare function mergeComponentAliases(components: ArchitectureComponent[]): ArchitectureComponent[];
//# sourceMappingURL=component-identity.d.ts.map