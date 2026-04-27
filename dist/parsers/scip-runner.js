/**
 * SCIP runner (Wave 2 T10).
 *
 * Shells out to scip-typescript, parses the resulting index.scip protobuf,
 * and surfaces RESOLVED cross-file edges — what tsserver actually sees,
 * not what regex guesses.
 *
 * Performance:
 *   - First run (cold cache): 400-1500ms on small repos. Always slower than
 *     the regex import-scanner.
 *   - Subsequent runs: scip-typescript has no cache; same cost.
 *   - This is why SCIP is opt-in (--scip flag / NAVGATOR_SCIP=1) — it buys
 *     accuracy at the cost of throughput.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// ESM equivalent of __dirname. NavGator is published as ESM (`"type": "module"`).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCIP_BIN_REL = path.join('node_modules', '@sourcegraph', 'scip-typescript', 'dist', 'src', 'main.js');
/**
 * Returns true if the project has a tsconfig.json (or jsconfig.json) at root.
 * scip-typescript needs one — `--infer-tsconfig` works but balloons cold time.
 */
export function hasTsConfig(projectRoot) {
    return (fs.existsSync(path.join(projectRoot, 'tsconfig.json')) ||
        fs.existsSync(path.join(projectRoot, 'jsconfig.json')));
}
/**
 * Resolve the scip-typescript bundled in this repo's node_modules. The
 * NavGator package depends on it as a devDep; consumers of NavGator do not
 * need it installed unless they opt in to SCIP.
 */
function resolveScipBin() {
    // Try the conventional locations: cwd/node_modules first, then the package
    // that imported THIS module (createRequire on import.meta.url).
    const candidates = [
        path.resolve(process.cwd(), SCIP_BIN_REL),
        path.resolve(__dirname, '..', '..', '..', SCIP_BIN_REL), // when running compiled from dist/
        path.resolve(__dirname, '..', '..', SCIP_BIN_REL),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return c;
    }
    // Last-resort: createRequire from this module's location.
    try {
        const req = createRequire(import.meta.url);
        return req.resolve('@sourcegraph/scip-typescript/dist/src/main.js');
    }
    catch {
        return null;
    }
}
/**
 * Index a project with scip-typescript and parse the resulting protobuf.
 * Returns the cross-file edges plus minimal metadata.
 *
 * Assumptions:
 *   - projectRoot has a tsconfig.json (call hasTsConfig() first or pass
 *     `inferTsconfig: true` to let scip-typescript guess).
 *   - The output file is written to a unique tmp path and cleaned up.
 */
export async function runScip(projectRoot, options = {}) {
    const t0 = Date.now();
    const result = {
        ok: false,
        edges: [],
        documents_indexed: 0,
        duration_ms: 0,
        cwd: projectRoot,
    };
    const bin = resolveScipBin();
    if (!bin) {
        result.error = '@sourcegraph/scip-typescript not installed';
        result.duration_ms = Date.now() - t0;
        return result;
    }
    if (!options.inferTsconfig && !hasTsConfig(projectRoot)) {
        result.error = `no tsconfig.json at ${projectRoot} (pass inferTsconfig: true to auto-generate one)`;
        result.duration_ms = Date.now() - t0;
        return result;
    }
    const outFile = path.join(os.tmpdir(), `navgator-scip-${process.pid}-${Date.now()}.scip`);
    const args = ['index', '--cwd', projectRoot, '--output', outFile, '--no-progress-bar'];
    if (options.inferTsconfig)
        args.push('--infer-tsconfig');
    if (options.maxFileBytes)
        args.push('--max-file-byte-size', options.maxFileBytes);
    const r = spawnSync('node', [bin, ...args], {
        stdio: 'pipe',
        timeout: options.timeoutMs ?? 60_000,
    });
    if (r.error || (r.status ?? -1) !== 0) {
        result.error = `scip-typescript failed: ${r.error?.message || r.stderr?.toString() || `exit ${r.status}`}`;
        result.duration_ms = Date.now() - t0;
        try {
            fs.unlinkSync(outFile);
        }
        catch { /* ignore */ }
        return result;
    }
    if (!fs.existsSync(outFile)) {
        result.error = `scip-typescript produced no output file at ${outFile}`;
        result.duration_ms = Date.now() - t0;
        return result;
    }
    try {
        // Lazy-require the embedded protobuf module — it isn't part of any public
        // API of scip-typescript so we go through the file path directly.
        const req = createRequire(import.meta.url);
        const scipMod = req(path.join(path.dirname(bin), 'scip.js'));
        const buf = fs.readFileSync(outFile);
        const idx = scipMod.scip.Index.deserializeBinary(buf);
        const obj = idx.toObject();
        result.documents_indexed = obj.documents.length;
        // Build a map of symbol → defining document so cross-file references can
        // be resolved to a `to_file`.
        const symbolDefDoc = new Map();
        const symbolDisplayName = new Map();
        for (const doc of obj.documents) {
            for (const s of doc.symbols ?? []) {
                if (!symbolDefDoc.has(s.symbol))
                    symbolDefDoc.set(s.symbol, doc.relative_path);
                if (s.display_name)
                    symbolDisplayName.set(s.symbol, s.display_name);
            }
            // Definitions (symbol_roles bit 0 = 1) also map symbol → doc.
            for (const occ of doc.occurrences ?? []) {
                if ((occ.symbol_roles ?? 0) & 0x1) {
                    if (!symbolDefDoc.has(occ.symbol))
                        symbolDefDoc.set(occ.symbol, doc.relative_path);
                }
            }
        }
        // Now walk all occurrences and emit edges.
        for (const doc of obj.documents) {
            for (const occ of doc.occurrences ?? []) {
                const isDef = ((occ.symbol_roles ?? 0) & 0x1) === 0x1;
                const range = occ.range ?? [];
                const fromLine = range.length >= 1 ? range[0] : 0;
                const toFile = symbolDefDoc.get(occ.symbol);
                result.edges.push({
                    from_file: doc.relative_path,
                    from_line: fromLine,
                    symbol: occ.symbol,
                    is_definition: isDef,
                    to_file: toFile && toFile !== doc.relative_path ? toFile : undefined,
                    display_name: symbolDisplayName.get(occ.symbol),
                });
            }
        }
        result.ok = true;
    }
    catch (err) {
        result.error = `parse failed: ${err.message}`;
    }
    finally {
        try {
            fs.unlinkSync(outFile);
        }
        catch { /* ignore */ }
        result.duration_ms = Date.now() - t0;
    }
    return result;
}
/**
 * Filter edges to cross-file references only — these are what callers
 * typically want for "what does file X import / call from?". Drops
 * definitions and same-file references.
 */
export function crossFileEdges(edges) {
    return edges.filter((e) => !e.is_definition && e.to_file && e.to_file !== e.from_file);
}
//# sourceMappingURL=scip-runner.js.map