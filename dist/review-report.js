/**
 * NavGator Review Report
 *
 * Single shared implementation of the `review` composite, used by both the
 * `navgator review` CLI command and the MCP `review` tool handler. Builds a
 * structured report from the architecture graph, then formats it to the
 * human-readable architecture text with additive live-coverage lines.
 */
import * as fs from "fs";
import { loadAllComponents, loadAllConnections } from "./storage.js";
import { getConfig, getPromptsPath } from "./config.js";
import { computeImpact } from "./impact.js";
import { resolveComponent } from "./resolve.js";
import { checkRules } from "./rules.js";
import { deduplicateLLMUseCases } from "./llm-dedup.js";
import { collectReviewScope } from "./review-scope.js";
/**
 * Build a structured review report. `opts.component`, when given, focuses
 * one section of the report on that component's impact — matching the
 * original behavior, an unresolvable `opts.component` is silently ignored
 * rather than treated as an error (only "no architecture data" errors).
 */
export async function buildReviewReport(opts = {}) {
    const projectRoot = opts.projectRoot ?? process.cwd();
    const config = getConfig();
    const components = await loadAllComponents(config, projectRoot);
    const connections = await loadAllConnections(config, projectRoot);
    if (components.length === 0) {
        return { error: "No architecture data. Run the scan tool first." };
    }
    const violations = checkRules(components, connections, undefined, projectRoot);
    let focus;
    if (opts.component) {
        const component = resolveComponent(opts.component, components);
        if (component) {
            const impact = computeImpact(component, components, connections);
            focus = {
                component_name: component.name,
                severity: impact.severity,
                summary: impact.summary,
                affected: impact.affected.map(a => a.component.name),
            };
        }
    }
    const runtime_topology = {};
    for (const c of components) {
        const rt = c.runtime?.resource_type;
        if (!rt)
            continue;
        runtime_topology[rt] = (runtime_topology[rt] || 0) + 1;
    }
    let llm;
    try {
        let prompts;
        try {
            const promptsPath = getPromptsPath(config, projectRoot);
            const raw = await fs.promises.readFile(promptsPath, "utf-8");
            prompts = JSON.parse(raw)?.prompts;
        }
        catch {
            /* no prompts */
        }
        const dedup = deduplicateLLMUseCases(components, connections, prompts);
        if (dedup.useCases.length > 0) {
            llm = { use_cases: dedup.useCases.length, providers: dedup.providers.length };
        }
    }
    catch {
        /* dedup not available */
    }
    const review_scope = await collectReviewScope(projectRoot, Date.now(), opts.pathPrefix);
    return { violations, focus, runtime_topology, llm, review_scope };
}
/**
 * Render a ReviewReport with additive live coverage warnings for Git worktrees.
 * Missing Git inventory remains visible as an incomplete-coverage warning.
 */
export function formatReviewReport(report) {
    const lines = ["ARCHITECTURE REVIEW"];
    if (report.violations.length > 0) {
        lines.push(`\nRule violations (${report.violations.length}):`);
        const bySev = {};
        for (const v of report.violations) {
            if (!bySev[v.severity])
                bySev[v.severity] = [];
            bySev[v.severity].push(v);
        }
        for (const sev of ["error", "warning", "info"]) {
            const group = bySev[sev];
            if (!group || group.length === 0)
                continue;
            lines.push(`\n${sev.toUpperCase()} (${group.length}):`);
            for (const v of group.slice(0, 5)) {
                lines.push(`[${v.severity.toUpperCase()}] ${v.message}`);
                if (v.suggestion)
                    lines.push(`  -> ${v.suggestion}`);
            }
            if (group.length > 5) {
                lines.push(`  ... and ${group.length - 5} more ${sev} violations`);
            }
        }
    }
    else {
        lines.push("\nRules: all passed");
    }
    if (report.focus) {
        lines.push(`\nImpact for ${report.focus.component_name}: ${report.focus.severity.toUpperCase()}`);
        lines.push(report.focus.summary);
        if (report.focus.affected.length > 0) {
            lines.push(`Affected: ${report.focus.affected.slice(0, 5).join(", ")}${report.focus.affected.length > 5 ? ` +${report.focus.affected.length - 5} more` : ""}`);
        }
    }
    const rtEntries = Object.entries(report.runtime_topology);
    if (rtEntries.length > 0) {
        const rtSummary = rtEntries.map(([t, n]) => `${t}: ${n}`).join(", ");
        lines.push(`\nRuntime topology: ${rtSummary}`);
    }
    if (report.llm) {
        lines.push(`\nAI/LLM: ${report.llm.use_cases} use cases across ${report.llm.providers} providers`);
    }
    const scope = report.review_scope;
    if (scope?.available) {
        const counts = scope.counts;
        if (scope.scope_prefix)
            lines.push(`\nScope filter: ${scope.scope_prefix} (${scope.outside_scope} changed files outside scope)`);
        lines.push(`\nLive change scope: ${counts.total} files (${counts.committed} committed, ${counts.staged} staged, ${counts.unstaged} unstaged, ${counts.untracked} untracked; surfaces may overlap)`);
        if (!scope.branch_base_known)
            lines.push('Branch base: unavailable; committed delta uses HEAD');
        if (scope.omitted_changed)
            lines.push(`Path sample omits ${scope.omitted_changed} changed files; scope the review before concluding coverage`);
        if (scope.behavioral_review.required) {
            lines.push(`Functional validation needed: ${scope.behavioral_review.matched_count} changed retrieval/persistence source files; run route, evidence, and no-write probes`);
        }
    }
    else if (scope) {
        lines.push(`\nLive change scope: unavailable (${scope.reason || 'unknown'}); review coverage is incomplete`);
    }
    if (scope && scope.scan.status !== 'fresh')
        lines.push(`Architecture scan: ${scope.scan.status}; refresh before relying on graph edges`);
    return lines.join("\n");
}
//# sourceMappingURL=review-report.js.map