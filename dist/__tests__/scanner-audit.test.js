/**
 * NavGator scanner ↔ audit integration test — Run 2 / D6
 *
 * End-to-end: run a scan on a tiny tmp-fixture project, assert that the
 * timeline entry's `audit` block is populated with a plan, sample size,
 * defect counts, and a verdict.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scan } from '../scanner.js';
import { loadIndex } from '../storage.js';
let workDir;
let origCwd;
beforeEach(() => {
    origCwd = process.cwd();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-audit-int-'));
    fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'audit-fixture', version: '0.0.0', dependencies: {} }, null, 2));
    fs.writeFileSync(path.join(workDir, 'src', 'a.ts'), `import { fromB } from './b';\nexport function fromA() { return fromB(); }\n`);
    fs.writeFileSync(path.join(workDir, 'src', 'b.ts'), `export function fromB() { return 1; }\n`);
    process.chdir(workDir);
});
afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
});
describe('scanner ↔ audit integration', () => {
    it('full scan emits audit block on timeline entry', async () => {
        const result = await scan(workDir, { mode: 'full', verbose: false });
        expect(result.timelineEntry).toBeDefined();
        const audit = result.timelineEntry?.audit;
        expect(audit).toBeDefined();
        if (!audit)
            return;
        expect(['AQL', 'SPRT', 'Cochran']).toContain(audit.plan);
        expect(audit.n).toBeGreaterThan(0);
        expect(audit.sampled).toBeGreaterThanOrEqual(0);
        expect(audit.defects).toBeGreaterThanOrEqual(0);
        expect(['accept', 'reject', 'continue']).toContain(audit.verdict);
        // CLI mode (no MCP context propagated) → llm_skipped should be true.
        expect(audit.llm_skipped).toBe(true);
        expect(audit.timestamp).toBeGreaterThan(0);
    }, 30000);
    it('--no-audit skips audit block', async () => {
        const result = await scan(workDir, { mode: 'full', noAudit: true });
        expect(result.timelineEntry?.audit).toBeUndefined();
    }, 30000);
    it('persists EWMA + audit_history_count on the index', async () => {
        await scan(workDir, { mode: 'full' });
        const index = (await loadIndex());
        expect(index).not.toBeNull();
        if (!index)
            return;
        expect(index.audit_history_count).toBeGreaterThanOrEqual(1);
        expect(index.ewma).toBeDefined();
    }, 30000);
    it('explicit --audit-plan=cochran picks Cochran', async () => {
        const result = await scan(workDir, { mode: 'full', auditPlan: 'cochran' });
        expect(result.timelineEntry?.audit?.plan).toBe('Cochran');
    }, 30000);
});
//# sourceMappingURL=scanner-audit.test.js.map