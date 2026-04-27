/**
 * NavGator Type Definitions
 * Architecture connection tracking for Claude Code
 */
// =============================================================================
// ID GENERATION
// =============================================================================
/**
 * Generate a component ID
 * Format: COMP_type_name_random
 */
export function generateComponentId(type, name) {
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
    const random = Math.random().toString(36).slice(2, 6);
    return `COMP_${type}_${sanitizedName}_${random}`;
}
/**
 * Slugify a name for use in a stable_id.
 * Lowercase; keep [a-z0-9._-]; collapse runs of other chars to '-'; trim '-'.
 * Length-cap at 64 chars to keep filenames sane.
 */
function slugifyForStableId(name) {
    const raw = (name ?? '').toString();
    const MAX = 48;
    const filtered = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    // Hash-suffix triggers — narrow to cases where input identity could
    // genuinely be lost. Routine punctuation folding (spaces, slashes, @scopes)
    // does NOT trigger; that would make most names noisy.
    const hasNonAscii = /[^\u0000-\u007f]/.test(raw);
    const wasEmpty = filtered === '';
    const trimmed = filtered.slice(0, MAX);
    const wasTruncated = filtered.length > MAX;
    if (!hasNonAscii && !wasEmpty && !wasTruncated) {
        return trimmed;
    }
    // FNV-1a 32-bit over original raw bytes — deterministic, dependency-free.
    // Disambiguates non-ASCII names, empty inputs, and >48-char names that
    // would otherwise collide after slugification (Codex audit fix).
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
        h = (h ^ raw.charCodeAt(i)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    const suffix = h.toString(36).padStart(7, '0').slice(0, 7);
    const base = trimmed || 'h';
    return `${base}-${suffix}`;
}
/**
 * Generate a stable, deterministic component identifier.
 * Format: STABLE_<type>_<slug>
 *
 * Same (type, name) → same stable_id across scans. This is the cross-scan
 * join key — distinct from `component_id` which carries a random suffix
 * for legacy backward compatibility.
 *
 * NOTE: collisions on (type, name) are intentional — they represent the
 * same logical component re-detected. Callers needing path-uniqueness
 * (e.g., two `prompt`-type components in different files) should pass a
 * canonical_path as the second argument when available.
 */
export function generateStableId(type, name, canonicalPath) {
    const slug = canonicalPath
        ? `${slugifyForStableId(canonicalPath)}__${slugifyForStableId(name)}`
        : slugifyForStableId(name);
    return `STABLE_${type}_${slug}`;
}
/**
 * Generate a connection ID
 * Format: CONN_type_random
 */
export function generateConnectionId(type) {
    const random = Math.random().toString(36).slice(2, 8);
    return `CONN_${type}_${random}`;
}
/**
 * Convert component to compact form
 */
export function toCompactComponent(c) {
    return {
        id: c.component_id,
        n: c.name,
        t: c.type,
        v: c.version,
        l: c.role.layer,
        s: c.status,
        ci: c.connected_from.length,
        co: c.connects_to.length,
    };
}
/**
 * Convert connection to compact form
 */
export function toCompactConnection(c) {
    return {
        id: c.connection_id,
        f: c.from.component_id,
        t: c.to.component_id,
        ct: c.connection_type,
        file: c.code_reference.file,
        sym: c.code_reference.symbol,
        st: c.code_reference.symbol_type,
        line: c.code_reference.line_start,
    };
}
//# sourceMappingURL=types.js.map