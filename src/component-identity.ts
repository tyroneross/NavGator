/**
 * NavGator Component Identity
 * Base-name normalization and alias merging, extracted from cli/commands/list.ts
 * so resolveComponent() and other callers can share the same identity rules.
 */

import { generateStableId, type ArchitectureComponent } from './types.js';

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
export function componentBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*config\b.*$/i, '')     // Remove "Config" and anything after
    .replace(/\s*\(.*\)$/i, '')          // Remove parenthetical
    .replace(/[@/].*/g, '')              // Remove @scope/version
    .trim();
}

/**
 * Build the merge/identity key for a component: base name + type.
 * Components of different types never share an identity, even with the same base name.
 */
export function identityKey(c: Pick<ArchitectureComponent, 'name' | 'type' | 'stable_id'>): string {
  // A path-scoped stable id carries owning-manifest/source identity that a
  // display-name alias must not erase. Name-only ids keep legacy aliasing for
  // labels such as "Railway Config" and "Railway".
  if (c.stable_id && c.stable_id !== generateStableId(c.type, c.name)) return c.stable_id;
  return `${componentBaseName(c.name)}|${c.type}`;
}

/**
 * Merge components that share an identity key (same base name + type), keeping
 * the one with more connections (connects_to + connected_from), matching the
 * keep-the-one-with-more-connections rule at list.ts:64-71.
 */
export function mergeComponentAliases(
  components: ArchitectureComponent[]
): ArchitectureComponent[] {
  const seen = new Map<string, ArchitectureComponent>();
  for (const c of components) {
    const key = identityKey(c);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, c);
    } else {
      const existingConns = existing.connects_to.length + existing.connected_from.length;
      const newConns = c.connects_to.length + c.connected_from.length;
      if (newConns > existingConns) {
        seen.set(key, c);
      }
    }
  }
  return [...seen.values()];
}
