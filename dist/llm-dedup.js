/**
 * LLM Use Case Deduplication
 *
 * Transforms raw LLM service-call connections (often 100+) into distinct
 * use cases (typically 5-15) by filtering noise and grouping by purpose.
 *
 * 3-layer pipeline:
 *   Layer 1 — Filter: remove test/dev, import-only, duplicates
 *   Layer 2 — Group: prompt match → function name → callType+model → file fallback
 *   Layer 3 — Merge: combine groups connected via import graph
 */
import * as fs from 'fs';
import * as path from 'path';
// =============================================================================
// HELPERS
// =============================================================================
function isMeaningfulSymbol(symbol) {
    if (!symbol || symbol.length <= 2)
        return false;
    if (symbol === 'default')
        return false;
    if (symbol.startsWith('./') || symbol.startsWith('/') || symbol.startsWith('..'))
        return false;
    // Generic symbols that don't indicate purpose
    if (['module', 'exports', 'require', 'import'].includes(symbol))
        return false;
    // Generic method names — too common to indicate a distinct use case
    if (['create', 'call', 'invoke', 'run', 'execute', 'send', 'post', 'get', 'fetch',
        'from', 'init', 'setup', 'config', 'use', 'with', 'wrap', 'log', 'emit',
        'on', 'off', 'set', 'add', 'remove', 'update', 'delete', 'load', 'save',
        'start', 'stop', 'open', 'close', 'connect', 'disconnect',
        'enabled', 'disabled', 'model', 'capture', 'samplingRate',
        'tracing_enabled', 'langsmith_enabled',
    ].includes(symbol))
        return false;
    // Provider/class names — these indicate WHO is called, not WHY
    const providerNames = [
        'openai', 'anthropic', 'groq', 'cohere', 'mistral', 'replicate',
        'chatopenai', 'chatgroq', 'chatanthropic', 'chatmistral',
        'langsmith', 'langchain',
    ];
    if (providerNames.includes(symbol.toLowerCase()))
        return false;
    // Anonymous/auto-generated function names
    if (/^anonymous_\d+$/.test(symbol))
        return false;
    // Common wrapper names that don't indicate purpose
    if (['traceable', 'fromZodSchema', 'withRetry'].includes(symbol))
        return false;
    return true;
}
const PURPOSE_PATTERNS = [
    // Specific patterns first (before generic ones like /generat/ that match too broadly)
    [/chart|visual|plot|diagram/i, 'chart-generation'],
    [/rerank|rank/i, 'reranking'],
    [/summar/i, 'summarization'],
    [/embed/i, 'embedding'],
    [/extract/i, 'extraction'],
    [/entity|ner|relation/i, 'entity-extraction'],
    [/theme|topic|cluster/i, 'theme-extraction'],
    [/trend|forecast/i, 'trend-analysis'],
    [/classif|categor|label/i, 'classification'],
    [/search|query|retriev/i, 'search'],
    [/translat/i, 'translation'],
    [/chat|convers|dialog/i, 'chat'],
    [/agent|tool|function.?call/i, 'agent'],
    [/synthe[sz]/i, 'synthesis'],
    [/chunk/i, 'chunking'],
    [/ingest|scrape|crawl|fetch.*rss/i, 'ingestion'],
    [/aggregat/i, 'aggregation'],
    // Generic patterns last (these match many file names)
    [/generat|produc/i, 'generation'],
    [/fallback|retry|backup/i, 'fallback'],
    [/validat|verif/i, 'validation'],
    [/analyz|analys/i, 'analysis'],
];
// Directory-to-domain mapping for purpose inference
const DIRECTORY_DOMAINS = [
    [/\/search\//i, 'search'],
    [/\/synthesis\//i, 'synthesis'],
    [/\/knowledge-graph\//i, 'knowledge-graph'],
    [/\/kg\//i, 'knowledge-graph'],
    [/\/queue\//i, 'queue-processing'],
    [/\/queues\//i, 'queue-processing'],
    [/\/workers?\//i, 'worker'],
    [/\/ai\//i, 'ai-core'],
    [/\/llm\//i, 'ai-core'],
    [/\/services\//i, 'service'],
    [/\/adapters?\//i, 'adapter'],
    [/\/ingestion\//i, 'ingestion'],
    [/\/aggregation\//i, 'aggregation'],
    [/\/analytics?\//i, 'analytics'],
];
function inferPurpose(functionName, fileName) {
    // Layer 1: Check function name (strongest signal)
    for (const [pattern, purpose] of PURPOSE_PATTERNS) {
        if (pattern.test(functionName))
            return purpose;
    }
    // Layer 2: Check file basename
    const basename = fileName.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    for (const [pattern, purpose] of PURPOSE_PATTERNS) {
        if (pattern.test(basename))
            return purpose;
    }
    // Layer 3: Directory inference (domain-level grouping)
    for (const [pattern, domain] of DIRECTORY_DOMAINS) {
        if (pattern.test(fileName))
            return domain;
    }
    return undefined;
}
/**
 * Load feature annotations from .navgator/features.yaml if present.
 * Returns a map of file glob → feature name.
 */
export function loadFeatureAnnotations(projectRoot) {
    const featuresPath = path.join(projectRoot, '.navgator', 'features.yaml');
    try {
        const content = fs.readFileSync(featuresPath, 'utf-8');
        const features = new Map();
        // Simple YAML parser for our format:
        // feature-name:
        //   files: [glob1, glob2]
        let currentFeature = '';
        let inFiles = false;
        for (const line of content.split('\n')) {
            const featureMatch = line.match(/^(\S+):\s*$/);
            if (featureMatch) {
                currentFeature = featureMatch[1];
                inFiles = false;
                continue;
            }
            if (line.trim() === 'files:' || line.trim().startsWith('files:')) {
                inFiles = true;
                // Check inline: files: [glob1, glob2]
                const inlineMatch = line.match(/files:\s*\[([^\]]+)\]/);
                if (inlineMatch) {
                    for (const glob of inlineMatch[1].split(',')) {
                        features.set(glob.trim().replace(/['"]/g, ''), currentFeature);
                    }
                    inFiles = false;
                }
                continue;
            }
            if (inFiles && line.trim().startsWith('- ')) {
                const glob = line.trim().slice(2).replace(/['"]/g, '').trim();
                if (glob && currentFeature) {
                    features.set(glob, currentFeature);
                }
            }
            else if (inFiles && !line.trim().startsWith('-') && line.trim().length > 0) {
                inFiles = false;
            }
        }
        return features.size > 0 ? features : null;
    }
    catch {
        return null; // No features.yaml
    }
}
function parseDescriptionForCallType(description) {
    if (!description)
        return null;
    // Common formats: "OpenAI.chat.completions.create (gpt-4)", "Groq.chat (llama-3.1-70b)"
    const match = description.match(/\.(\w+(?:\.\w+)*?)(?:\s*\(([^)]+)\))?$/);
    if (!match)
        return null;
    const method = match[1]; // e.g., "chat.completions.create" or "chat"
    const model = match[2]?.trim();
    if (!method)
        return null;
    return { method, model };
}
function mostCommonFile(conns) {
    const counts = new Map();
    for (const c of conns) {
        const f = c.code_reference.file;
        counts.set(f, (counts.get(f) || 0) + 1);
    }
    let best = '';
    let bestCount = 0;
    for (const [f, count] of counts) {
        if (count > bestCount) {
            best = f;
            bestCount = count;
        }
    }
    return best || conns[0]?.code_reference.file || 'unknown';
}
function fileBasename(filepath) {
    const parts = filepath.split('/');
    const file = parts[parts.length - 1] || filepath;
    return file.replace(/\.[^.]+$/, ''); // strip extension
}
// =============================================================================
// MAIN FUNCTION
// =============================================================================
export function deduplicateLLMUseCases(components, connections, prompts) {
    // Step 1: Find LLM components
    const llmComponents = components.filter(c => c.type === 'llm');
    const llmIds = new Set(llmComponents.map(c => c.component_id));
    const llmNameById = new Map(llmComponents.map(c => [c.component_id, c.name]));
    if (llmIds.size === 0) {
        return { useCases: [], totalCallSites: 0, productionCallSites: 0, providers: [] };
    }
    // Step 2: Get all LLM connections
    const allLLMConns = connections.filter(c => llmIds.has(c.to.component_id));
    const totalCallSites = allLLMConns.length;
    if (totalCallSites === 0) {
        return { useCases: [], totalCallSites: 0, productionCallSites: 0, providers: llmComponents.map(c => c.name) };
    }
    // =========================================================================
    // LAYER 1: Filter
    // =========================================================================
    // 1a. Remove test/dev-only/migration
    let filtered = allLLMConns.filter(c => {
        const cls = c.semantic?.classification;
        return cls !== 'test' && cls !== 'dev-only' && cls !== 'migration';
    });
    // 1b. Remove import-only (import with no sibling call from same file+provider)
    const hasCallFromFileProvider = new Set();
    for (const c of filtered) {
        if (c.code_reference.symbol_type !== 'import') {
            hasCallFromFileProvider.add(`${c.code_reference.file}|${c.to.component_id}`);
        }
    }
    filtered = filtered.filter(c => {
        if (c.code_reference.symbol_type !== 'import')
            return true;
        // Keep import only if there's a sibling call from same file to same provider
        return hasCallFromFileProvider.has(`${c.code_reference.file}|${c.to.component_id}`);
    });
    // 1c. Deduplicate same (file, symbol, target)
    const seen = new Set();
    filtered = filtered.filter(c => {
        const key = `${c.code_reference.file}|${c.code_reference.symbol}|${c.to.component_id}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    const productionCallSites = filtered.length;
    const groups = new Map();
    // Step 1: Group all connections by their source file
    for (const conn of filtered) {
        const file = conn.code_reference.file;
        if (!groups.has(file)) {
            groups.set(file, {
                name: '',
                groupedBy: 'file',
                providerIds: new Set(),
                connections: [],
            });
        }
        const group = groups.get(file);
        group.providerIds.add(conn.to.component_id);
        group.connections.push(conn);
    }
    // Step 2: Classify each file group — purpose + name
    for (const [file, group] of groups) {
        let purpose;
        // Check prompt match
        if (prompts && prompts.length > 0) {
            const matchedPrompt = prompts.find(p => p.location.file === file || p.usedBy.some(u => u.file === file));
            if (matchedPrompt) {
                purpose = matchedPrompt.category && matchedPrompt.category !== 'unknown' ? matchedPrompt.category : undefined;
                group.name = matchedPrompt.name;
                if (purpose)
                    group.groupedBy = 'prompt';
            }
        }
        // Check meaningful function names in this group
        if (!purpose) {
            for (const conn of group.connections) {
                if (isMeaningfulSymbol(conn.code_reference.symbol)) {
                    const fnPurpose = inferPurpose(conn.code_reference.symbol, file);
                    if (fnPurpose) {
                        purpose = fnPurpose;
                        group.name = conn.code_reference.symbol;
                        group.groupedBy = 'function';
                        break;
                    }
                }
            }
        }
        // Basename + directory inference
        if (!purpose) {
            purpose = inferPurpose('', file);
        }
        // Set name from basename if still unnamed
        if (!group.name) {
            group.name = fileBasename(file);
        }
        group.category = purpose;
    }
    // =========================================================================
    // BUILD RESULT
    // =========================================================================
    const useCases = [];
    for (const group of groups.values()) {
        // Resolve provider name — prefer actual LLM SDKs over observability wrappers
        const OBSERVABILITY_PROVIDERS = new Set(['langsmith', 'datadog', 'opentelemetry', 'sentry']);
        const providerCounts = new Map();
        for (const pid of group.providerIds) {
            providerCounts.set(pid, (providerCounts.get(pid) || 0) + 1);
        }
        let mainProviderId = '';
        let maxCount = 0;
        // First pass: find the best non-observability provider
        let bestNonObsId = '';
        let bestNonObsCount = 0;
        for (const [pid, count] of providerCounts) {
            const name = llmNameById.get(pid)?.toLowerCase() || '';
            if (!OBSERVABILITY_PROVIDERS.has(name) && count > bestNonObsCount) {
                bestNonObsId = pid;
                bestNonObsCount = count;
            }
        }
        // Fall back to any provider if all are observability
        if (!bestNonObsId) {
            for (const [pid, count] of providerCounts) {
                if (count > maxCount) {
                    mainProviderId = pid;
                    maxCount = count;
                }
            }
        }
        else {
            mainProviderId = bestNonObsId;
        }
        const providerName = llmNameById.get(mainProviderId) || 'unknown';
        // Find what the LLM call's file connects to downstream (for agent classification)
        const primaryFileId = `FILE:${mostCommonFile(group.connections)}`;
        const downstream = connections
            .filter(c => c.from.component_id === primaryFileId && !llmIds.has(c.to.component_id))
            .map(c => {
            const target = components.find(comp => comp.component_id === c.to.component_id);
            return target ? `${target.name} (${target.type})` : c.to.component_id;
        })
            .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
            .slice(0, 5); // limit to 5
        useCases.push({
            name: group.name,
            category: group.category,
            provider: providerName,
            model: group.model,
            primaryFile: mostCommonFile(group.connections),
            callSites: group.connections.length,
            productionCallSites: group.connections.length,
            groupedBy: group.groupedBy,
            feedsInto: downstream.length > 0 ? downstream : undefined,
        });
    }
    // Final pass: re-classify any use case without a category by checking its primary file
    for (const uc of useCases) {
        if (!uc.category) {
            const purpose = inferPurpose('', uc.primaryFile);
            if (purpose) {
                uc.category = purpose;
                if (uc.name.includes('(uncategorized)')) {
                    uc.name = `${uc.provider} ${purpose}`;
                }
            }
        }
    }
    // Sort by productionCallSites descending
    useCases.sort((a, b) => b.productionCallSites - a.productionCallSites);
    // Collect unique provider names
    const providers = [...new Set(useCases.map(u => u.provider))].filter(p => p !== 'unknown');
    return { useCases, totalCallSites, productionCallSites, providers };
}
//# sourceMappingURL=llm-dedup.js.map