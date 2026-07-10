/**
 * Markdown content graph scanner.
 *
 * Models each Markdown file as a document component and extracts internal
 * Obsidian wikilinks, relative Markdown links, and typed frontmatter edges.
 * External URLs and links inside fenced/inline code are intentionally ignored.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateComponentId, generateConnectionId, generateStableId, } from '../../types.js';
const TYPED_RELATION_FIELDS = new Set([
    'supports',
    'contradicts',
    'supersedes',
    'superseded_by',
    'depends_on',
    'extends',
    'related',
    'tested_by',
]);
const NON_DOCUMENT_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|csv|tsv|txt|html?|xml|zip|mp3|m4a|wav|mp4|mov|json|ya?ml|py|tsx?|jsx?|rs|swift)$/i;
function normalizeProjectPath(file) {
    return file.split(path.sep).join('/').replace(/^\.\//, '');
}
function stripQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function parseInlineList(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return [];
    if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        return [stripQuotes(trimmed).replace(/^\[\[|\]\]$/g, '').trim()].filter(Boolean);
    }
    const body = trimmed.slice(1, -1);
    return body
        .split(',')
        .map(stripQuotes)
        .map(item => item.replace(/^\[\[|\]\]$/g, '').trim())
        .filter(Boolean);
}
function parseFrontmatter(content) {
    const fields = new Map();
    const lines = content.split(/\r?\n/);
    if (lines[0]?.trim() !== '---')
        return { fields, bodyStartLine: 1 };
    let currentKey;
    let closingLine = -1;
    for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        if (line.trim() === '---') {
            closingLine = index;
            break;
        }
        const fieldMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
        if (fieldMatch) {
            currentKey = fieldMatch[1].toLowerCase();
            const values = parseInlineList(fieldMatch[2]);
            fields.set(currentKey, values);
            continue;
        }
        const listMatch = line.match(/^\s+-\s+(.+)$/);
        if (listMatch && currentKey) {
            const values = fields.get(currentKey) ?? [];
            values.push(...parseInlineList(listMatch[1]));
            fields.set(currentKey, values);
        }
    }
    return {
        fields,
        bodyStartLine: closingLine >= 0 ? closingLine + 2 : 1,
    };
}
function first(fields, key) {
    return fields.get(key)?.[0];
}
function pathIdentity(file) {
    return normalizeProjectPath(file).replace(/\.md$/i, '');
}
function makeDocument(file, content, now) {
    const { fields, bodyStartLine } = parseFrontmatter(content);
    const fallbackIdentity = pathIdentity(file);
    const declaredPageId = first(fields, 'id');
    const pageId = declaredPageId ?? fallbackIdentity;
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = first(fields, 'title') ?? heading ?? pageId;
    const aliases = fields.get('aliases') ?? [];
    const component = {
        component_id: generateComponentId('document', pageId),
        stable_id: generateStableId('document', pageId),
        name: pageId,
        type: 'document',
        role: {
            purpose: `Markdown content: ${title}`,
            layer: 'content',
            critical: file.startsWith('_system/') || file === 'AGENTS.md' || file === 'CLAUDE.md',
        },
        source: {
            detection_method: 'auto',
            config_files: [file],
            confidence: 0.98,
        },
        connects_to: [],
        connected_from: [],
        status: 'active',
        tags: ['markdown', 'content'],
        metadata: {
            file,
            page_id: pageId,
            title,
            frontmatter_type: first(fields, 'type'),
            page_status: first(fields, 'status'),
            aliases,
        },
        timestamp: now,
        last_updated: now,
    };
    return {
        file,
        content,
        bodyStartLine,
        fields,
        pageId,
        explicitPageId: declaredPageId !== undefined,
        title,
        aliases,
        component,
    };
}
function normalizeWikiTarget(target) {
    const normalized = target
        .split('|', 1)[0]
        .split('#', 1)[0]
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\.md$/i, '');
    return NON_DOCUMENT_EXTENSIONS.test(normalized) ? '' : normalized;
}
function normalizeMarkdownTarget(target) {
    let normalized = target.trim().replace(/^<|>$/g, '');
    if (!normalized || normalized.startsWith('#'))
        return null;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalized))
        return null;
    normalized = normalized.split('#', 1)[0].split('?', 1)[0];
    normalized = normalized.replace(/\s+["'][^"']*["']\s*$/, '');
    try {
        normalized = decodeURIComponent(normalized);
    }
    catch {
        // Keep the literal target when percent encoding is malformed.
    }
    normalized = normalized.trim();
    if (!normalized || NON_DOCUMENT_EXTENSIONS.test(normalized))
        return null;
    return normalized;
}
function extractBodyLinks(doc) {
    const hits = [];
    const lines = doc.content.split(/\r?\n/);
    let inFence = false;
    for (let index = doc.bodyStartLine - 1; index < lines.length; index++) {
        const original = lines[index];
        if (/^\s*(```|~~~)/.test(original)) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        const line = original.replace(/`[^`]*`/g, '');
        const lineNumber = index + 1;
        const wikiRe = /!?\[\[([^\]]+)\]\]/g;
        let match;
        while ((match = wikiRe.exec(line)) !== null) {
            const target = normalizeWikiTarget(match[1]);
            if (target) {
                hits.push({
                    type: 'wikilink',
                    target,
                    line: lineNumber,
                    snippet: original.trim().slice(0, 160),
                });
            }
        }
        const markdownRe = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
        while ((match = markdownRe.exec(line)) !== null) {
            const target = normalizeMarkdownTarget(match[1]);
            if (target) {
                hits.push({
                    type: 'markdown-link',
                    target,
                    line: lineNumber,
                    snippet: original.trim().slice(0, 160),
                });
            }
        }
    }
    return hits;
}
function extractTypedRelationships(doc) {
    const hits = [];
    const frontmatterLines = doc.content.split(/\r?\n/).slice(0, Math.max(0, doc.bodyStartLine - 1));
    for (const field of TYPED_RELATION_FIELDS) {
        for (const target of doc.fields.get(field) ?? []) {
            const normalized = normalizeWikiTarget(target);
            if (!normalized)
                continue;
            const line = Math.max(1, frontmatterLines.findIndex(value => value.startsWith(`${field}:`)) + 1);
            hits.push({
                type: 'typed-relationship',
                target: normalized,
                line,
                field,
                snippet: `${field}: ${target}`,
            });
        }
    }
    return hits;
}
function addUniqueLookup(map, key, doc) {
    const normalized = key.trim().toLowerCase();
    if (!normalized)
        return;
    if (!map.has(normalized))
        map.set(normalized, doc);
    else if (map.get(normalized)?.file !== doc.file)
        map.set(normalized, null);
}
function resolveWikiTarget(target, identityLookup, pathLookup) {
    const normalized = normalizeWikiTarget(target).toLowerCase();
    return identityLookup.get(normalized) ?? pathLookup.get(normalized) ?? undefined;
}
function resolveMarkdownTarget(sourceFile, target, byFile) {
    const normalized = normalizeMarkdownTarget(target);
    if (!normalized)
        return undefined;
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), normalized.replace(/\\/g, '/')));
    if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative))
        return undefined;
    const candidates = relative.toLowerCase().endsWith('.md')
        ? [relative]
        : [relative, `${relative}.md`, normalizeProjectPath(path.join(relative, 'README.md'))];
    return candidates.map(candidate => byFile.get(candidate)).find(Boolean);
}
function makeConnection(source, target, hit, now) {
    const relationship = hit.field ? ` (${hit.field})` : '';
    return {
        connection_id: generateConnectionId(hit.type),
        from: {
            component_id: source.component.component_id,
            location: { file: source.file, line: hit.line },
        },
        to: {
            component_id: target.component.component_id,
            location: { file: target.file, line: 1 },
        },
        connection_type: hit.type,
        code_reference: {
            file: source.file,
            symbol: hit.field ?? hit.target,
            line_start: hit.line,
            code_snippet: hit.snippet,
        },
        semantic: { classification: 'production', confidence: 0.9 },
        description: `${source.pageId} links to ${target.pageId}${relationship}`,
        detected_from: hit.type === 'typed-relationship' ? `frontmatter:${hit.field}` : hit.type,
        confidence: hit.type === 'typed-relationship' ? 0.98 : 0.95,
        timestamp: now,
        last_verified: now,
    };
}
/**
 * Scan a known Markdown file universe. `walkSet` limits connection origins for
 * incremental scans while all document components are returned so targets can
 * still resolve and prior connections can be remapped by stable_id.
 */
export async function scanMarkdownContent(projectRoot, markdownFiles, walkSet) {
    const now = Date.now();
    const documents = [];
    const warnings = [];
    for (const rawFile of markdownFiles) {
        const file = normalizeProjectPath(rawFile);
        try {
            const content = await fs.promises.readFile(path.join(projectRoot, file), 'utf-8');
            documents.push(makeDocument(file, content, now));
        }
        catch (error) {
            warnings.push({
                type: 'parse_error',
                file,
                message: `Could not read Markdown file: ${error instanceof Error ? error.message : 'unknown error'}`,
            });
        }
    }
    const byFile = new Map(documents.map(doc => [doc.file, doc]));
    const identityLookup = new Map();
    const pathLookup = new Map();
    for (const doc of documents) {
        if (doc.explicitPageId)
            addUniqueLookup(identityLookup, doc.pageId, doc);
        for (const alias of doc.aliases)
            addUniqueLookup(identityLookup, alias, doc);
        addUniqueLookup(pathLookup, pathIdentity(doc.file), doc);
        addUniqueLookup(pathLookup, path.basename(doc.file, '.md'), doc);
    }
    const connections = [];
    for (const source of documents) {
        if (walkSet && !walkSet.has(source.file))
            continue;
        const hits = [...extractTypedRelationships(source), ...extractBodyLinks(source)];
        const seen = new Set();
        for (const hit of hits) {
            const target = hit.type === 'markdown-link'
                ? resolveMarkdownTarget(source.file, hit.target, byFile)
                : resolveWikiTarget(hit.target, identityLookup, pathLookup);
            const key = `${hit.type}|${hit.field ?? ''}|${hit.target}|${hit.line}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            if (!target) {
                warnings.push({
                    type: 'unresolved_link',
                    file: source.file,
                    line: hit.line,
                    message: `Unresolved ${hit.type} target "${hit.target}" in ${source.file}:${hit.line}`,
                });
                continue;
            }
            connections.push(makeConnection(source, target, hit, now));
        }
    }
    return {
        components: documents.map(doc => doc.component),
        connections,
        warnings,
    };
}
//# sourceMappingURL=markdown-scanner.js.map