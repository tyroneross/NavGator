import { wrapInEnvelope } from '../../agent-output.js';
import { writeSnapshotForCurrentRef } from '../../git-aware/canonical.js';
import { premergeDiff } from '../../git-aware/premerge-diff.js';
export function registerArchDiffCommand(program) {
    program
        .command('arch-diff')
        .description('Pre-merge architecture diff: current branch vs. canonical (or a named --base ref)')
        .option('--base <ref>', 'Diff against this ref\'s recorded snapshot instead of the canonical baseline')
        .option('--record', 'Also write the current ref\'s snapshot before diffing (canonical if on the default branch, else branches/<slug>)')
        .option('--json', 'Output as JSON')
        .option('--agent', 'Output wrapped in agent envelope (implies --json)')
        .action(async (options) => {
        try {
            const root = process.cwd();
            const isAgent = !!options.agent;
            const isJson = !!options.json || isAgent;
            let recorded;
            if (options.record) {
                recorded = await writeSnapshotForCurrentRef(root);
            }
            const result = await premergeDiff(root, { base: options.base });
            const data = { ...result, recorded: recorded ?? null };
            if (isAgent) {
                console.log(wrapInEnvelope('arch-diff', data));
            }
            else if (isJson) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                printHuman(data);
            }
            // House convention (mirrors scan-remote): exitCode 2 signals "ran
            // fine, nothing to report yet" — never a crash, but never silently
            // 0 as though the diff itself succeeded.
            if (!result.available) {
                process.exitCode = 2;
            }
        }
        catch (error) {
            console.error('arch-diff failed:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
}
function printHuman(data) {
    console.log('NavGator Pre-Merge Architecture Diff');
    console.log('='.repeat(60));
    if (data.recorded) {
        console.log(`Recorded snapshot for "${data.recorded.ref ?? '(unknown)'}" -> ${data.recorded.path} (${data.recorded.isDefault ? 'canonical' : 'branch'})`);
    }
    console.log(`Base: ${data.base}`);
    console.log(`Head: ${data.head ?? '(unresolved)'}`);
    console.log('');
    if (!data.available) {
        console.log(`No diff available: ${data.reason}`);
        return;
    }
    const diff = data.diff;
    const sig = data.significance;
    console.log(`Significance: ${sig.significance} (${sig.triggers.join(', ') || 'none'})`);
    console.log(`Total changes: ${diff.stats.total_changes}`);
    console.log('');
    console.log(`Components added (${diff.components.added.length}):`);
    for (const c of diff.components.added)
        console.log(`  + ${c.name} (${c.type}, ${c.layer})`);
    console.log(`Components removed (${diff.components.removed.length}):`);
    for (const c of diff.components.removed)
        console.log(`  - ${c.name} (${c.type}, ${c.layer})`);
    console.log(`Components modified (${diff.components.modified.length}):`);
    for (const c of diff.components.modified)
        console.log(`  ~ ${c.name}: ${c.changes.join('; ')}`);
    console.log('');
    console.log(`Connections added (${diff.connections.added.length}):`);
    for (const c of diff.connections.added)
        console.log(`  + ${c.from_name} -> ${c.to_name} (${c.type})`);
    console.log(`Connections removed (${diff.connections.removed.length}):`);
    for (const c of diff.connections.removed)
        console.log(`  - ${c.from_name} -> ${c.to_name} (${c.type})`);
}
//# sourceMappingURL=arch-diff.js.map