import { scan } from '../../scanner.js';
import { wrapInEnvelope } from '../../agent-output.js';
export function registerScanCommand(program) {
    program
        .command('scan')
        .description('Scan project architecture and update connection tracking')
        .option('-q, --quick', 'Quick scan (packages only, no code analysis)')
        .option('-c, --connections', 'Focus on connection detection')
        .option('-p, --prompts', 'Enhanced AI prompt scanning with full content')
        .option('-v, --verbose', 'Show detailed output')
        .option('--clear', 'Clear existing data before scanning (alias for --full)')
        .option('--full', 'Force a full scan (clear all and rebuild)')
        .option('--incremental', 'Force an incremental scan (walk only changed files + reverse-deps)')
        .option('--auto', 'Auto-pick mode based on file changes and index staleness (default)')
        .option('--ast', 'Use AST-based scanning (more accurate, slightly slower)')
        .option('--track-branch', 'Capture git branch/commit in scan output')
        .option('--commit', 'Auto-commit scan output to nested .navgator/.git for temporal queries (~180ms overhead)')
        .option('--scip', 'Run SCIP indexer for compiler-accurate cross-file edges (requires tsconfig; ~500ms cold)')
        .option('--field-usage', 'Analyze DB field usage across codebase (requires Prisma schema)')
        .option('--typespec', 'Validate Prisma types against TypeScript interfaces')
        .option('--no-audit', 'Skip the SQC audit pass (Run 2)')
        .option('--audit-plan <plan>', 'Audit plan: aql | sprt | cochran (default: auto)')
        .option('--json', 'Output scan results as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (options) => {
        try {
            const isAgent = !!options.agent;
            const isJson = !!options.json || isAgent;
            // Suppress console output in agent/json mode
            const origLog = console.log;
            if (isJson) {
                console.log = () => { };
            }
            // Resolve mode: explicit flags > --clear (legacy alias) > default 'auto'.
            // Mutually-exclusive flags resolve in priority order full > incremental > auto.
            let mode = 'auto';
            if (options.full || options.clear)
                mode = 'full';
            else if (options.incremental)
                mode = 'incremental';
            else if (options.auto)
                mode = 'auto';
            const result = await scan(process.cwd(), {
                quick: options.quick,
                connections: options.connections,
                prompts: options.prompts,
                verbose: options.verbose,
                clearFirst: options.clear,
                mode,
                useAST: options.ast,
                trackBranch: options.trackBranch,
                fieldUsage: options.fieldUsage,
                typeSpec: options.typespec,
                commit: options.commit,
                scip: options.scip,
                // Run 2 — D4: SQC audit. Commander's `--no-audit` sets
                // `options.audit === false`; we map that to `noAudit: true`.
                noAudit: options.audit === false,
                auditPlan: options.auditPlan,
            });
            // Restore console for output
            if (isJson) {
                console.log = origLog;
            }
            // JSON/Agent output mode
            if (isJson) {
                const jsonData = {
                    components_found: result.stats.components_found,
                    connections_found: result.stats.connections_found,
                    scan_duration_ms: result.stats.scan_duration_ms,
                    files_scanned: result.stats.files_scanned,
                    files_changed: result.stats.files_changed,
                    warnings_count: result.stats.warnings_count,
                    prompts_found: result.stats.prompts_found,
                };
                if (result.gitInfo) {
                    jsonData.git = result.gitInfo;
                }
                if (result.timelineEntry) {
                    jsonData.significance = result.timelineEntry.significance;
                    jsonData.triggers = result.timelineEntry.triggers;
                    jsonData.total_changes = result.timelineEntry.diff.stats.total_changes;
                    if (result.timelineEntry.audit) {
                        jsonData.audit = result.timelineEntry.audit;
                    }
                }
                if (isAgent) {
                    console.log(wrapInEnvelope('scan', jsonData));
                }
                else {
                    console.log(JSON.stringify(jsonData, null, 2));
                }
                return;
            }
            console.log('\n========================================');
            console.log('SCAN COMPLETE');
            console.log('========================================\n');
            // Group components by type
            const byType = {};
            for (const c of result.components) {
                byType[c.type] = (byType[c.type] || 0) + 1;
            }
            console.log('COMPONENTS:');
            for (const [type, count] of Object.entries(byType)) {
                console.log(`  ${type}: ${count}`);
            }
            // Group connections by type
            const connByType = {};
            for (const c of result.connections) {
                connByType[c.connection_type] = (connByType[c.connection_type] || 0) + 1;
            }
            if (Object.keys(connByType).length > 0) {
                console.log('\nCONNECTIONS:');
                for (const [type, count] of Object.entries(connByType)) {
                    console.log(`  ${type}: ${count}`);
                }
            }
            if (result.warnings.length > 0) {
                console.log(`\nWARNINGS: ${result.warnings.length}`);
                for (const w of result.warnings.slice(0, 5)) {
                    console.log(`  - ${w.message}`);
                }
                if (result.warnings.length > 5) {
                    console.log(`  ... and ${result.warnings.length - 5} more`);
                }
            }
            // Show file change summary
            if (result.fileChanges) {
                const { added, modified, removed } = result.fileChanges;
                if (added.length > 0 || modified.length > 0 || removed.length > 0) {
                    console.log('\nFILE CHANGES:');
                    if (added.length > 0)
                        console.log(`  Added: ${added.length}`);
                    if (modified.length > 0)
                        console.log(`  Modified: ${modified.length}`);
                    if (removed.length > 0)
                        console.log(`  Removed: ${removed.length}`);
                }
            }
            // Show prompt scan results if enhanced scanning was used
            if (result.promptScan && result.promptScan.prompts.length > 0) {
                console.log('\nAI PROMPTS:');
                console.log(`  Total: ${result.promptScan.summary.totalPrompts}`);
                console.log(`  Templates: ${result.promptScan.summary.templatesCount}`);
                if (Object.keys(result.promptScan.summary.byProvider).length > 0) {
                    console.log('  By provider:');
                    for (const [provider, count] of Object.entries(result.promptScan.summary.byProvider)) {
                        console.log(`    ${provider}: ${count}`);
                    }
                }
            }
            console.log(`\nFiles scanned: ${result.stats.files_scanned}`);
            console.log(`Scan completed in ${result.stats.scan_duration_ms}ms`);
            // Show branch info if tracking
            if (result.gitInfo) {
                console.log(`Branch: ${result.gitInfo.branch} @ ${result.gitInfo.commit}`);
            }
            // Project registration is now handled inside the scanner (Phase 5)
            // Show timeline entry summary if available
            if (result.timelineEntry && result.timelineEntry.diff.stats.total_changes > 0) {
                console.log(`\nArchitecture diff: ${result.timelineEntry.significance.toUpperCase()} — ${result.timelineEntry.diff.stats.total_changes} change(s)`);
                if (result.timelineEntry.triggers.length > 0) {
                    console.log(`  Triggers: ${result.timelineEntry.triggers.join(', ')}`);
                }
            }
        }
        catch (error) {
            console.error('Scan failed:', error);
            process.exit(1);
        }
    });
}
//# sourceMappingURL=scan.js.map