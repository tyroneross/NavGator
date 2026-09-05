/**
 * imports-scip oracle — truth frame: compiler-resolved cross-file references
 * from scip-typescript (what tsserver sees, not what a regex guesses).
 *
 * This is a SAMPLED truth frame: scip-typescript indexes the documents the
 * tsconfig reaches, so recall is a bound that tightens with `frame_coverage`
 * (documents indexed / TS files in the stored file list). Report both
 * (protocol step 10; ISSTA 2024 Theorem 3.3, packet source [8]).
 *
 * Join key: unordered file pair? No — directed `from → to` file pair. A map
 * `imports` edge from file A to component X counts as a true positive when
 * SCIP records a reference from A to X's defining file. Map edges whose source
 * file is outside the indexed set are out-of-frame and excluded from the
 * precision denominator (counted in notes).
 *
 * Off by default: spawning the indexer costs 1–120 s. Enabled by
 * `navgator scan --scip` or `navgator audit-report --scip`; timeout via
 * `--scip-timeout <ms>` or NAVGATOR_SCIP_TIMEOUT_MS (default 120000).
 */
import * as path from 'path';
import { noOracle, setDiffOracle } from './common.js';
function norm(p) {
    if (!p)
        return null;
    let s = p.replace(/\\/g, '/');
    if (s.startsWith('./'))
        s = s.slice(2);
    if (path.isAbsolute(s))
        return null;
    return s;
}
export async function importsScipOracle(input, opts) {
    if (!opts.enabled)
        return noOracle('imports-scip', 'connection-imports', 'skipped: run `navgator scan --scip` or `navgator audit-report --scip` to enable');
    const { runScip, crossFileEdges, hasTsConfig } = await import('../../parsers/scip-runner.js');
    if (!hasTsConfig(input.projectRoot))
        return noOracle('imports-scip', 'connection-imports', 'no tsconfig.json / jsconfig.json at project root');
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 120_000;
    const scip = await runScip(input.projectRoot, { timeoutMs });
    if (!scip.ok) {
        // Finding (c): a timeout is reported as its own reason so the reader can raise it.
        const timedOut = /ETIMEDOUT|timed? ?out/i.test(scip.error ?? '');
        return noOracle('imports-scip', 'connection-imports', timedOut
            ? `scip-typescript timed out after ${timeoutMs} ms (${scip.duration_ms} ms elapsed); raise with --scip-timeout <ms> or NAVGATOR_SCIP_TIMEOUT_MS`
            : `scip-typescript unavailable: ${scip.error ?? 'unknown error'}`);
    }
    const indexedDocs = new Set();
    const truth = new Set();
    for (const e of scip.edges) {
        const from = norm(e.from_file);
        if (from)
            indexedDocs.add(from);
    }
    for (const e of crossFileEdges(scip.edges)) {
        const from = norm(e.from_file);
        const to = norm(e.to_file);
        if (from && to)
            truth.add(`${from} -> ${to}`);
    }
    const map = new Set();
    let outOfFrame = 0;
    let noTarget = 0;
    for (const conn of input.connections) {
        if (conn.connection_type !== 'imports')
            continue;
        const from = norm(conn.code_reference?.file ?? conn.from?.location?.file);
        if (!from)
            continue;
        const target = input.componentById.get(conn.to?.component_id ?? '');
        const to = norm(conn.to?.location?.file ?? target?.source?.config_files?.[0]);
        if (!to) {
            noTarget++;
            continue;
        }
        if (!indexedDocs.has(from)) {
            outOfFrame++;
            continue;
        }
        map.add(`${from} -> ${to}`);
    }
    let tsFiles = 0;
    if (input.hashes?.files) {
        for (const f of Object.keys(input.hashes.files))
            if (/\.(ts|tsx|mts|cts)$/.test(f))
                tsFiles++;
    }
    const coverage = tsFiles > 0 ? Math.min(1, indexedDocs.size / tsFiles) : undefined;
    const notes = [
        `truth = ${truth.size} directed file pairs from scip-typescript (${scip.documents_indexed} documents, ${scip.duration_ms} ms)`,
        'map = stored `imports` connections as (source file -> target file) pairs',
        `${outOfFrame} map edges outside the indexed document set excluded; ${noTarget} map edges had no resolvable target file`,
    ];
    const res = setDiffOracle('imports-scip', 'connection-imports', 'independent', truth, map, notes);
    if (coverage !== undefined)
        res.frame_coverage = coverage;
    return res;
}
//# sourceMappingURL=imports-scip.js.map