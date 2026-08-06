/**
 * deep-map — tier 1/2/3 work-packet construction.
 *
 * NavGator never calls a model: this module turns tier-0 facts (components,
 * connections, the partition, the escalation scores) into deterministic,
 * ready-to-send prompts. The CALLING agent sends each packet's `prompt` to
 * whatever model it has access to and writes the result back next to the
 * packet; `ingest.ts` (not this file) validates what comes back.
 *
 * Determinism is a hard requirement, not a nicety — packets get diffed and
 * re-sent across sessions, and a byte-different prompt for the same input
 * would silently invalidate any caching or resumability built on top of this.
 * So: no timestamps, no random ids, no relying on Map/Set/Object iteration
 * order — every list that isn't already deterministically ordered by an
 * upstream module (`partition.ts`, `escalate.ts`) is sorted explicitly here.
 */
import { toCompactConnection } from '../types.js';
import { extractSubgraph } from '../subgraph.js';
import { makePacketId } from './store.js';
import { DEEP_MAP_LIMITS, DEEP_MAP_SCHEMA_VERSION, UNTRUSTED_SOURCE_NOTE, } from './types.js';
/** Serialized prompt chars / 4 — an estimate, and labelled as one everywhere it surfaces. */
export function estimateInputTokens(prompt) {
    return Math.ceil(prompt.length / 4);
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** Files listed per packet component are capped so one sprawling component cannot dominate a packet. */
const FILES_PER_COMPONENT_CAP = 12;
/** component_id -> file paths, sorted. Sorting makes the result independent of fileMap's own key order. */
function invertFileMap(fileMap) {
    const byComponent = new Map();
    for (const [file, componentId] of Object.entries(fileMap)) {
        const list = byComponent.get(componentId);
        if (list)
            list.push(file);
        else
            byComponent.set(componentId, [file]);
    }
    for (const list of byComponent.values())
        list.sort();
    return byComponent;
}
function toPacketComponent(component, filesByComponent) {
    const files = (filesByComponent.get(component.component_id) ?? []).slice(0, FILES_PER_COMPONENT_CAP);
    const out = {
        component_id: component.component_id,
        name: component.name,
        type: component.type,
        layer: component.role.layer,
        files,
    };
    if (component.stable_id)
        out.stable_id = component.stable_id;
    return out;
}
function untrustedPrefix(provenance) {
    return provenance.untrusted ? `${UNTRUSTED_SOURCE_NOTE}\n\n` : '';
}
function formatComponentsBlock(components) {
    if (components.length === 0)
        return '(none)';
    return components
        .map((c) => {
        const filesLine = c.files.length > 0 ? c.files.join(', ') : '(no files mapped)';
        return `- ${c.name} [${c.component_id}] type=${c.type} layer=${c.layer}\n  files: ${filesLine}`;
    })
        .join('\n');
}
function formatEdgesBlock(edges, emptyLabel) {
    if (edges.length === 0)
        return emptyLabel;
    return edges.map((e) => `- ${e.f} -> ${e.t} (${e.ct}) at ${e.file}:${e.sym}`).join('\n');
}
/**
 * Plain JSON-Schema-shaped object describing the `*.result.json` file
 * `ingest.ts` expects. Built fresh from `DEEP_MAP_LIMITS` on every call so the
 * documented bounds and the enforced bounds can never drift apart silently.
 */
function buildResponseSchema() {
    return {
        type: 'object',
        required: ['findings'],
        properties: {
            findings: {
                type: 'array',
                maxItems: DEEP_MAP_LIMITS.findingsPerPacket,
                items: {
                    type: 'object',
                    required: ['component_id', 'kind', 'text', 'evidence', 'confidence'],
                    properties: {
                        component_id: {
                            type: 'string',
                            description: 'Must be one of the component ids listed in this packet.',
                        },
                        kind: {
                            type: 'string',
                            enum: ['purpose', 'responsibility', 'concern', 'inefficiency', 'risk', 'cross-cutting'],
                        },
                        text: { type: 'string', maxLength: DEEP_MAP_LIMITS.textLength },
                        evidence: {
                            type: 'array',
                            maxItems: DEEP_MAP_LIMITS.evidencePerFinding,
                            items: { type: 'string', maxLength: DEEP_MAP_LIMITS.evidenceLength },
                            description: 'Real repo file paths (or file:symbol) backing this finding.',
                        },
                        confidence: { type: 'number', minimum: 0, maximum: 1 },
                    },
                },
            },
            model: { type: 'string' },
        },
    };
}
// ---------------------------------------------------------------------------
// Tier 1 — per-group identification
// ---------------------------------------------------------------------------
function buildTier1Prompt(group, components, edges, provenance) {
    const prefixLine = group.path_prefix || '(none — spans unrelated directories)';
    const edgesBlock = formatEdgesBlock(edges, '(no edges within this group)');
    const componentsBlock = formatComponentsBlock(components);
    if (group.residual) {
        return (`${untrustedPrefix(provenance)}` +
            `NavGator deep-map — tier 1 (residual triage)\n\n` +
            `Group: ${group.label} (${group.unit} partition, RESIDUAL)\n` +
            `Path prefix: ${prefixLine}\n\n` +
            `These components did NOT cluster together in the dependency graph — this is not a ` +
            `cohesive module, it is a bag of singleton/orphan components folded together because ` +
            `none of them met the minimum group size on its own. Do not describe this group as if ` +
            `it has a shared purpose.\n\n` +
            `Components:\n${componentsBlock}\n\n` +
            `Edges within this group:\n${edgesBlock}\n\n` +
            `For EACH component listed above, decide which of these it is:\n` +
            `- STRAGGLER: plausibly belongs with a named part of the codebase — name that part in the finding text\n` +
            `- STANDALONE: genuinely independent and does not belong anywhere else\n` +
            `- DEAD: shows no sign of active use and looks like dead code\n\n` +
            `Respond with JSON matching response_schema. Use kind="concern" and start each ` +
            `component's finding text with one of STRAGGLER:, STANDALONE:, or DEAD:, followed by ` +
            `your reasoning. component_id must be one of the ids listed above, and evidence must ` +
            `cite real file paths from the files listed for that component.`);
    }
    return (`${untrustedPrefix(provenance)}` +
        `NavGator deep-map — tier 1 (component identification)\n\n` +
        `Group: ${group.label} (${group.unit} partition)\n` +
        `Path prefix: ${prefixLine}\n\n` +
        `This group contains ${components.length} component(s) that cluster together in the ` +
        `dependency graph.\n\n` +
        `Components:\n${componentsBlock}\n\n` +
        `Edges within this group:\n${edgesBlock}\n\n` +
        `For EACH component listed above, determine:\n` +
        `- purpose: one sentence describing what it does\n` +
        `- responsibilities: up to 3 short bullet points\n` +
        `- concerns: up to 3 short bullet points (code smells, risks, or state "none")\n` +
        `- confidence: a number 0..1 for how confident you are\n\n` +
        `Respond with JSON matching response_schema: one finding per component per kind ` +
        `(purpose/responsibility/concern), each finding's component_id must be one of the ids ` +
        `listed above, and evidence must cite real file paths from the files listed for that ` +
        `component.`);
}
export function buildTier1Packets(input) {
    const componentsById = new Map(input.components.map((c) => [c.component_id, c]));
    const filesByComponent = invertFileMap(input.fileMap);
    return input.partition.groups.map((group, index) => {
        const groupIdSet = new Set(group.component_ids);
        const packetComponents = group.component_ids
            .map((id) => componentsById.get(id))
            .filter((c) => Boolean(c))
            .map((c) => toPacketComponent(c, filesByComponent));
        // The induced subgraph on the group — a direct filter, not a traversal.
        // Asking `extractSubgraph` for depth 1 and filtering afterwards loses
        // edges: depth 1 collects every one-hop neighbour OUTSIDE the group, and
        // the `maxNodes` truncation that follows can cut genuine group members
        // before the filter runs. On a four-member group with twelve outside
        // neighbours that returned zero of the four internal edges.
        const edges = input.connections
            .filter((c) => groupIdSet.has(c.from.component_id) && groupIdSet.has(c.to.component_id))
            .map(toCompactConnection);
        const prompt = buildTier1Prompt(group, packetComponents, edges, input.provenance);
        const packet = {
            schema_version: DEEP_MAP_SCHEMA_VERSION,
            packet_id: makePacketId(1, index + 1),
            run_id: input.runId,
            tier: 1,
            group_label: group.label,
            component_ids: group.component_ids,
            components: packetComponents,
            edges,
            prompt,
            response_schema: buildResponseSchema(),
            estimated_input_tokens: estimateInputTokens(prompt),
            provenance: input.provenance,
        };
        return packet;
    });
}
// ---------------------------------------------------------------------------
// Tier 2 — per-escalated-component deep dive
// ---------------------------------------------------------------------------
function buildTier2Prompt(score, subject, widerComponents, widerEdges, directConnections, provenance) {
    const subjectLabel = subject ? `${subject.name} [${subject.component_id}]` : score.component_id;
    const reasonsBlock = score.reasons.length > 0 ? score.reasons.map((r) => `- ${r}`).join('\n') : '(no contributing signals above zero)';
    const connectionsBlock = directConnections.length > 0
        ? directConnections
            .map((c) => {
            const direction = c.from.component_id === score.component_id ? 'OUT' : 'IN';
            return `- ${direction} ${c.from.component_id} -> ${c.to.component_id} (${c.connection_type}) at ${c.code_reference.file}:${c.code_reference.symbol}`;
        })
            .join('\n')
        : '(no direct connections)';
    const widerComponentsBlock = formatComponentsBlock(widerComponents);
    const widerEdgesBlock = formatEdgesBlock(widerEdges, '(no edges in the 2-hop neighbourhood)');
    return (`${untrustedPrefix(provenance)}` +
        `NavGator deep-map — tier 2 (deep dive: inefficiencies, coupling, design risk)\n\n` +
        `Component: ${subjectLabel} (escalation score ${score.score.toFixed(3)})\n\n` +
        `This component was escalated for a closer look. It is ALSO covered by a tier-1 packet ` +
        `that already answers "what is it" — do not restate purpose here. Focus only on problems.\n\n` +
        `Why escalated:\n${reasonsBlock}\n\n` +
        `Raw signals:\n` +
        `- pagerank: ${score.raw.pagerank} (${(score.raw.pagerank_percentile * 100).toFixed(0)}th percentile)\n` +
        `- cross-community edges: ${score.raw.cross_community_edges} of ${score.raw.total_edges} total\n` +
        `- structural violations: ${score.raw.structural_violations.length > 0 ? score.raw.structural_violations.join(', ') : 'none'}\n` +
        `- llm service-call edges: ${score.raw.llm_calls}\n` +
        `- file count: ${score.raw.file_count} (${(score.raw.file_count_percentile * 100).toFixed(0)}th percentile)\n\n` +
        `Connections (this component's own edges):\n${connectionsBlock}\n\n` +
        `Wider context (2-hop neighbourhood, up to 40 nodes):\n${widerComponentsBlock}\n\n` +
        `Edges in wider context:\n${widerEdgesBlock}\n\n` +
        `For this component, identify specific inefficiencies, coupling risks, and design ` +
        `problems — NOT what it does, only what is wrong with how it is built or used. Each ` +
        `finding must cite file:symbol evidence pulled from the connections or files listed ` +
        `above.\n\n` +
        `Respond with JSON matching response_schema. Use kind="inefficiency" or kind="risk". ` +
        `component_id must be "${score.component_id}". evidence must cite real file:symbol or file ` +
        `path evidence, not a restatement of the concern.`);
}
export function buildTier2Packets(input) {
    if (!input.escalation)
        return [];
    const componentsById = new Map(input.components.map((c) => [c.component_id, c]));
    const filesByComponent = invertFileMap(input.fileMap);
    return input.escalation.escalated.map((score, index) => {
        const component = componentsById.get(score.component_id);
        const subject = component ? toPacketComponent(component, filesByComponent) : null;
        const subgraph = extractSubgraph(input.components, input.connections, {
            focus: [score.component_id],
            depth: 2,
            maxNodes: 40,
        });
        const widerComponents = subgraph.components
            .map((cc) => componentsById.get(cc.id))
            .filter((c) => Boolean(c))
            .map((c) => toPacketComponent(c, filesByComponent));
        const directConnections = input.connections
            .filter((c) => c.from.component_id === score.component_id || c.to.component_id === score.component_id)
            .slice()
            .sort((a, b) => (a.connection_id < b.connection_id ? -1 : a.connection_id > b.connection_id ? 1 : 0));
        const prompt = buildTier2Prompt(score, subject, widerComponents, subgraph.connections, directConnections, input.provenance);
        const packet = {
            schema_version: DEEP_MAP_SCHEMA_VERSION,
            packet_id: makePacketId(2, index + 1),
            run_id: input.runId,
            tier: 2,
            group_label: `deep-dive/${score.component_id}`,
            component_ids: [score.component_id],
            components: widerComponents,
            edges: subgraph.connections,
            prompt,
            response_schema: buildResponseSchema(),
            estimated_input_tokens: estimateInputTokens(prompt),
            provenance: input.provenance,
        };
        return packet;
    });
}
// ---------------------------------------------------------------------------
// Tier 3 — single cross-cutting synthesis packet
// ---------------------------------------------------------------------------
function formatFindingsGrouped(findings) {
    if (findings.length === 0)
        return '(none)';
    const lines = [];
    let currentComponent = null;
    for (const f of findings) {
        if (f.component_id !== currentComponent) {
            currentComponent = f.component_id;
            lines.push(`Component ${f.component_name} [${f.component_id}]:`);
        }
        const evidenceSuffix = f.evidence.length > 0 ? ` [evidence: ${f.evidence.join(', ')}]` : '';
        lines.push(`  - (${f.kind}, confidence ${f.confidence}) ${f.text}${evidenceSuffix}`);
    }
    return lines.join('\n');
}
function buildTier3Prompt(input, packetComponents, edges, escalationTable, sortedFindings) {
    const escalatedSuffix = input.escalation
        ? `, ${input.escalation.escalated.length} escalated for tier-2`
        : ' (no escalation data)';
    const escalationBlock = escalationTable.length > 0
        ? escalationTable
            .map((s) => `- ${s.name} [${s.component_id}] score=${s.score.toFixed(3)} :: ${s.reasons.length > 0 ? s.reasons.join('; ') : 'no contributing signals'}`)
            .join('\n')
        : '(none escalated)';
    const findingsBlock = formatFindingsGrouped(sortedFindings);
    const componentsBlock = formatComponentsBlock(packetComponents);
    const edgesBlock = formatEdgesBlock(edges, '(no edges among referenced components)');
    return (`${untrustedPrefix(input.provenance)}` +
        `NavGator deep-map — tier 3 (cross-cutting synthesis)\n\n` +
        `Graph counts: ${input.components.length} components, ${input.connections.length} connections, ` +
        `${input.partition.groups.length} tier-1 groups${escalatedSuffix}.\n\n` +
        `Escalation table:\n${escalationBlock}\n\n` +
        `Findings so far, grouped by component:\n${findingsBlock}\n\n` +
        `Components referenced above:\n${componentsBlock}\n\n` +
        `Edges among referenced components:\n${edgesBlock}\n\n` +
        `Identify cross-component issues only visible in aggregate — patterns across findings, ` +
        `systemic risks, duplicated concerns, architecture-level problems no single component's ` +
        `finding captures on its own.\n\n` +
        `Respond with JSON matching response_schema. Every finding.component_id MUST be one of ` +
        `the component ids listed under "Components referenced above". Every finding MUST include ` +
        `at least one evidence string that is a real repo file path. Use kind="cross-cutting".`);
}
export function buildTier3Packet(input, findings) {
    if (findings.length === 0)
        return null;
    const componentsById = new Map(input.components.map((c) => [c.component_id, c]));
    const filesByComponent = invertFileMap(input.fileMap);
    const escalatedIds = input.escalation ? input.escalation.escalated.map((s) => s.component_id) : [];
    const findingIds = findings.map((f) => f.component_id);
    const coveredIds = [...new Set([...escalatedIds, ...findingIds])].sort();
    const packetComponents = coveredIds
        .map((id) => componentsById.get(id))
        .filter((c) => Boolean(c))
        .map((c) => toPacketComponent(c, filesByComponent));
    const coveredSet = new Set(packetComponents.map((c) => c.component_id));
    const subgraph = extractSubgraph(input.components, input.connections, {
        focus: coveredIds,
        depth: 1,
        maxNodes: Math.max(coveredIds.length, 1),
    });
    const edges = subgraph.connections.filter((e) => coveredSet.has(e.f) && coveredSet.has(e.t));
    const sortedFindings = [...findings].sort((a, b) => {
        if (a.component_id !== b.component_id)
            return a.component_id < b.component_id ? -1 : 1;
        return a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0;
    });
    const escalationTable = input.escalation ? input.escalation.escalated : [];
    const prompt = buildTier3Prompt(input, packetComponents, edges, escalationTable, sortedFindings);
    const packet = {
        schema_version: DEEP_MAP_SCHEMA_VERSION,
        packet_id: makePacketId(3, 1),
        run_id: input.runId,
        tier: 3,
        group_label: 'cross-cutting',
        component_ids: packetComponents.map((c) => c.component_id),
        components: packetComponents,
        edges,
        prompt,
        response_schema: buildResponseSchema(),
        estimated_input_tokens: estimateInputTokens(prompt),
        provenance: input.provenance,
    };
    return packet;
}
//# sourceMappingURL=packets.js.map