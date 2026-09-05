/**
 * queue oracle — truth frame: `new Queue('name')` / `new Worker('name')` /
 * `new Bull('name')` string literals found by an INDEPENDENT source walk (not
 * the scanner's file list). A queue declared only on its consumer side
 * (`new Worker`) is still a real queue.
 *
 * Strength is 'weak' by design: a string literal is the same evidence class
 * the scanner uses (packet §5.3 — string-literal inference is a 15–20%
 * precision problem for shipping tools), so this oracle re-derives rather
 * than corroborates. It still catches queues the scanner dropped or invented.
 *
 * Map side: `queue` components NOT sourced from package.json (the npm scanner
 * also types `bullmq` / `bull` as `queue`; those are packages, not queues).
 */
import * as fs from 'fs';
import * as path from 'path';
import { isRootPackageDerived, noOracle, setDiffOracle, walkSourceFiles } from './common.js';
// `new Queue<T>('name', …)` — generic params, newlines after `(` and any quote style.
const QUEUE_LITERAL = /new\s+(?:Queue|Bull|Worker|QueueScheduler|QueueEvents)(?:<[^>()]*>)?\s*\(\s*(['"`])([^'"`$\n]+)\1/g;
// `new Queue(QUEUE_NAME, …)` / `new Queue(queueConfigs.summaries.name, …)` — identifier args to resolve.
const QUEUE_IDENT = /new\s+(?:Queue|Bull|Worker|QueueScheduler|QueueEvents)(?:<[^>()]*>)?\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*[,)]/g;
const CTOR_HINT = /new\s+(?:Queue|Bull|Worker)/;
function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Resolve an identifier argument to a string literal:
 *   IDENT            → `IDENT = 'lit'` in the same file, else anywhere in the walk
 *   a.b.name / a.b   → `b: { … name: 'lit' … }` anywhere in the walk (config objects)
 */
function resolveIdent(ident, sameFile, corpus) {
    const parts = ident.split('.');
    if (parts.length === 1) {
        const re = new RegExp(`\\b${escapeRe(ident)}\\s*(?::\\s*string)?\\s*=\\s*(['"\`])([^'"\`$\\n]+)\\1`);
        const local = re.exec(sameFile);
        if (local)
            return local[2];
        // Cross-file resolution only for SCREAMING_CASE constants; a bare `name` or
        // `queueName` would match unrelated assignments elsewhere in the repo.
        if (!/^[A-Z][A-Z0-9_]+$/.test(ident))
            return null;
        for (const c of corpus) {
            const m = re.exec(c);
            if (m)
                return m[2];
        }
        return null;
    }
    // Object path: take the segment before a trailing `.name` (or the last segment).
    const key = parts[parts.length - 1] === 'name' && parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
    const re = new RegExp(`\\b${escapeRe(key)}\\s*:\\s*\\{[^}]*?\\bname\\s*:\\s*(['"\`])([^'"\`$\\n]+)\\1`);
    for (const c of [sameFile, ...corpus]) {
        const m = re.exec(c);
        if (m)
            return m[2];
    }
    return null;
}
export function queueLiterals(root) {
    const names = new Set();
    const unresolved = [];
    const files = walkSourceFiles(root);
    const contents = [];
    const hinted = [];
    for (const abs of files) {
        let content;
        try {
            content = fs.readFileSync(abs, 'utf-8');
        }
        catch {
            continue;
        }
        contents.push(content);
        if (CTOR_HINT.test(content))
            hinted.push({ content });
    }
    for (const { content } of hinted) {
        QUEUE_LITERAL.lastIndex = 0;
        let m;
        while ((m = QUEUE_LITERAL.exec(content)) !== null)
            names.add(m[2].trim());
        QUEUE_IDENT.lastIndex = 0;
        while ((m = QUEUE_IDENT.exec(content)) !== null) {
            const ident = m[1];
            const lit = resolveIdent(ident, content, contents);
            if (lit)
                names.add(lit.trim());
            else
                unresolved.push(ident);
        }
    }
    return { names, files: files.length, unresolved: [...new Set(unresolved)] };
}
export function queueOracle(input) {
    const { names: truth, files, unresolved } = queueLiterals(input.projectRoot);
    const map = new Set();
    for (const c of input.components) {
        if (c.type !== 'queue')
            continue;
        if (isRootPackageDerived(c))
            continue;
        if ((c.source?.config_files ?? []).some((f) => path.basename(f) === 'package.json'))
            continue;
        map.add(c.name);
    }
    if (truth.size === 0 && map.size === 0)
        return noOracle('queue', 'infra', `no queue literals in ${files} source files and no queue components`);
    return setDiffOracle('queue', 'infra', 'weak', truth, map, [
        `truth = new Queue/Worker/Bull('…') literals from an independent walk of ${files} source files (same evidence class as the scanner → weak)`,
        'map = queue components not sourced from package.json',
        ...(unresolved.length > 0 ? [`${unresolved.length} constructor arguments could not be resolved to a literal: ${unresolved.slice(0, 5).join(', ')}`] : []),
    ]);
}
//# sourceMappingURL=queue.js.map