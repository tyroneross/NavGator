/**
 * Queue Scanner
 * Detects BullMQ/Bull queues, workers, and producer-consumer relationships
 */
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { generateComponentId, generateConnectionId, } from '../../types.js';
/**
 * Scan source files for queue definitions (new Queue, new Worker, etc.)
 */
async function findQueueDefinitions(projectRoot, walkSet) {
    const queues = [];
    const warnings = [];
    const allSourceFiles = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs}', {
        cwd: projectRoot,
        ignore: [
            '**/node_modules/**', '**/dist/**', '**/build/**',
            '**/.next/**', '**/coverage/**', '**/.git/**',
        ],
    });
    const sourceFiles = walkSet
        ? allSourceFiles.filter(f => walkSet.has(f))
        : allSourceFiles;
    for (const file of sourceFiles) {
        try {
            const content = await fs.promises.readFile(path.join(projectRoot, file), 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNum = i + 1;
                // BullMQ / Bull: new Queue('name', ...)
                const queueMatch = line.match(/new\s+Queue\s*\(\s*['"`]([^'"`]+)['"`]/);
                if (queueMatch) {
                    const library = detectQueueLibrary(content);
                    const redisInfo = extractRedisConnection(lines, i);
                    queues.push({
                        name: queueMatch[1],
                        file,
                        line: lineNum,
                        type: 'producer',
                        library,
                        symbol: extractSymbol(line, lines, i),
                        ...redisInfo,
                    });
                }
                // BullMQ: new Worker('name', handler, ...) or new Worker(variable, handler, ...)
                // Handle multi-line: new Worker<Type>(\n  queueName,\n  handler)
                const workerDetect = line.match(/new\s+Worker\s*(?:<[^>]*>)?\s*\(/);
                let workerName = null;
                if (workerDetect) {
                    // Check same line for string literal
                    const sameLine = line.match(/new\s+Worker\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/);
                    if (sameLine) {
                        workerName = sameLine[1];
                    }
                    else {
                        // Check same line for variable ref
                        const sameLineVar = line.match(/new\s+Worker\s*(?:<[^>]*>)?\s*\(\s*(\S+)/);
                        if (sameLineVar && sameLineVar[1] !== '(' && !sameLineVar[1].startsWith('//')) {
                            workerName = resolveVariableToString(sameLineVar[1], content, path.join(projectRoot, file));
                        }
                        // Check next line if argument isn't on current line (multi-line constructor)
                        if (!workerName && i + 1 < lines.length) {
                            const nextLine = lines[i + 1].trim();
                            const nextLiteral = nextLine.match(/^['"`]([^'"`]+)['"`]/);
                            if (nextLiteral) {
                                workerName = nextLiteral[1];
                            }
                            else {
                                const nextVar = nextLine.match(/^(\S+?)[\s,]/);
                                if (nextVar) {
                                    workerName = resolveVariableToString(nextVar[1], content, path.join(projectRoot, file));
                                }
                            }
                        }
                    }
                }
                if (workerName) {
                    const concurrency = extractConcurrency(content, i, lines);
                    const retryAttempts = extractRetryAttempts(content, i, lines);
                    const redisInfo = extractRedisConnection(lines, i);
                    queues.push({
                        name: workerName,
                        file,
                        line: lineNum,
                        type: 'consumer',
                        library: 'bullmq',
                        concurrency,
                        retryAttempts,
                        symbol: extractSymbol(line, lines, i),
                        ...redisInfo,
                    });
                }
                // Bull: queue.process(concurrency, handler) or queue.process(handler)
                const processMatch = line.match(/(\w+)\.process\s*\(/);
                if (processMatch && content.includes('bull') && !content.includes('bullmq')) {
                    // Try to find the queue name from the variable declaration
                    const varName = processMatch[1];
                    const nameMatch = content.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*new\\s+(?:Bull|Queue)\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`));
                    if (nameMatch) {
                        queues.push({
                            name: nameMatch[1],
                            file,
                            line: lineNum,
                            type: 'consumer',
                            library: 'bull',
                            symbol: varName,
                        });
                    }
                }
                // BullMQ: FlowProducer
                const flowMatch = line.match(/new\s+FlowProducer\s*\(/);
                if (flowMatch) {
                    queues.push({
                        name: '__flow_producer__',
                        file,
                        line: lineNum,
                        type: 'producer',
                        library: 'bullmq',
                        symbol: extractSymbol(line, lines, i),
                    });
                }
                // Queue.add() or queue.add() - detect additional producers
                const addMatch = line.match(/(\w+)\.add\s*\(\s*['"`]([^'"`]+)['"`]/);
                if (addMatch) {
                    // Only if the variable looks like a queue instance
                    const varName = addMatch[0].split('.')[0];
                    if (content.match(new RegExp(`${varName}\\s*[:=].*(?:Queue|bull|queue)`, 'i'))) {
                        // Already tracked via new Queue(), just note the job name
                    }
                }
            }
        }
        catch {
            // Skip unreadable files
        }
    }
    return { queues, warnings };
}
/**
 * Detect which queue library is being used
 */
function detectQueueLibrary(content) {
    if (content.includes("from 'bullmq'") || content.includes('from "bullmq"') ||
        content.includes("require('bullmq')") || content.includes('require("bullmq")')) {
        return 'bullmq';
    }
    if (content.includes("from 'bull'") || content.includes('from "bull"') ||
        content.includes("require('bull')") || content.includes('require("bull")')) {
        return 'bull';
    }
    if (content.includes("from 'bee-queue'") || content.includes('from "bee-queue"')) {
        return 'bee-queue';
    }
    return 'unknown';
}
/**
 * Extract concurrency from Worker options
 */
function extractConcurrency(content, lineIndex, lines) {
    // Look within a few lines after the Worker constructor for concurrency
    const context = lines.slice(lineIndex, lineIndex + 10).join('\n');
    const match = context.match(/concurrency\s*[:=]\s*(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
}
/**
 * Extract retry attempts from Worker options
 */
function extractRetryAttempts(content, lineIndex, lines) {
    const context = lines.slice(lineIndex, lineIndex + 15).join('\n');
    const match = context.match(/attempts\s*[:=]\s*(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
}
/**
 * Extract the variable/const name the queue is assigned to
 */
/**
 * Try to resolve a variable reference to its string value.
 * Handles: queueConfigs.entityExtraction.name, QUEUE_NAME, etc.
 */
/**
 * Try to resolve a variable reference to its string value.
 * Handles: queueConfigs.entityExtraction.name, QUEUE_NAME, etc.
 * Also follows imports to resolve cross-file config references.
 */
function resolveVariableToString(varRef, content, filePath) {
    // Remove trailing comma, paren
    const cleaned = varRef.replace(/[,)]/g, '').trim();
    // Direct string constant: const QUEUE_NAME = 'my-queue'
    const constMatch = content.match(new RegExp(`(?:const|let|var)\\s+${cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`));
    if (constMatch)
        return constMatch[1];
    // Object property: queueConfigs.entityExtraction.name
    if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        const lastProp = parts[parts.length - 1]; // 'name'
        const parentProp = parts[parts.length - 2]; // 'entityExtraction'
        if (lastProp === 'name' && parentProp) {
            // Search in current file
            const configRegex = new RegExp(`${parentProp}[:\\s]+\\{[^}]*name:\\s*['"\`]([^'"\`]+)['"\`]`, 's');
            const configMatch = content.match(configRegex);
            if (configMatch)
                return configMatch[1];
            // Try imported config file: look for import of the root variable
            const rootVar = parts[0];
            if (filePath) {
                const importMatch = content.match(new RegExp(`import\\s+.*${rootVar}.*from\\s+['"\`]([^'"\`]+)['"\`]`));
                if (importMatch) {
                    const importPath = importMatch[1];
                    const dir = path.dirname(filePath);
                    // Try resolving the import
                    for (const ext of ['.ts', '.js', '/index.ts', '/index.js', '']) {
                        const resolved = path.resolve(dir, importPath + ext);
                        try {
                            const importContent = fs.readFileSync(resolved, 'utf-8');
                            const importConfigMatch = importContent.match(configRegex);
                            if (importConfigMatch)
                                return importConfigMatch[1];
                        }
                        catch { /* file not found, try next */ }
                    }
                }
            }
        }
    }
    return null;
}
function extractSymbol(line, lines, lineIndex) {
    // Check current line: const myQueue = new Queue(...)
    const assignMatch = line.match(/(?:const|let|var|export\s+(?:const|let))\s+(\w+)\s*=/);
    if (assignMatch)
        return assignMatch[1];
    // Check if it's a class property: this.queue = new Queue(...)
    const propMatch = line.match(/this\.(\w+)\s*=/);
    if (propMatch)
        return propMatch[1];
    // Check previous line for the variable declaration
    if (lineIndex > 0) {
        const prevLine = lines[lineIndex - 1];
        const prevMatch = prevLine.match(/(?:const|let|var)\s+(\w+)\s*=\s*$/);
        if (prevMatch)
            return prevMatch[1];
    }
    return 'anonymous';
}
/**
 * Best-effort extraction of Redis connection info from Queue/Worker constructor args.
 * Looks at the options object in the lines around the constructor call.
 * Handles:
 *   { connection: process.env.REDIS_URL }
 *   { connection: { host: 'redis.railway.internal', port: 6379 } }
 */
function extractRedisConnection(lines, lineIndex) {
    // Capture up to 10 lines starting from the match line to cover multi-line constructors
    const context = lines.slice(lineIndex, lineIndex + 10).join('\n');
    // Check for process.env.SOMETHING as the connection value
    const envMatch = context.match(/connection\s*:\s*process\.env\.([A-Z_][A-Z0-9_]*)/);
    if (envMatch) {
        return { redisEnvVar: envMatch[1] };
    }
    // Check for inline { host, port }
    const hostMatch = context.match(/connection\s*:.*?host\s*:\s*['"`]([^'"`]+)['"`]/s);
    const portMatch = context.match(/connection\s*:.*?port\s*:\s*(\d+)/s);
    if (hostMatch || portMatch) {
        return {
            redisEndpoint: {
                host: hostMatch?.[1],
                port: portMatch ? parseInt(portMatch[1], 10) : undefined,
            },
        };
    }
    return {};
}
// =============================================================================
// SCANNER
// =============================================================================
/**
 * Scan for queue definitions and create components/connections
 */
export async function scanQueues(projectRoot, walkSet) {
    const components = [];
    const connections = [];
    const warnings = [];
    const timestamp = Date.now();
    const { queues, warnings: scanWarnings } = await findQueueDefinitions(projectRoot, walkSet);
    warnings.push(...scanWarnings);
    if (queues.length === 0) {
        return { components, connections, warnings };
    }
    // Group by queue name to build topology
    const queueMap = new Map();
    for (const q of queues) {
        const group = queueMap.get(q.name) || [];
        group.push(q);
        queueMap.set(q.name, group);
    }
    const queueComponentMap = new Map(); // queueName -> component_id
    for (const [queueName, definitions] of queueMap) {
        if (queueName === '__flow_producer__')
            continue; // Skip FlowProducer meta-entry
        const producers = definitions.filter(d => d.type === 'producer');
        const consumers = definitions.filter(d => d.type === 'consumer');
        // Create the queue component
        const componentId = generateComponentId('queue', queueName);
        queueComponentMap.set(queueName, componentId);
        const concurrency = consumers.find(c => c.concurrency)?.concurrency;
        const retryAttempts = consumers.find(c => c.retryAttempts)?.retryAttempts;
        const library = definitions[0].library;
        // Best-effort: pick first definition that has Redis connection info
        const redisEnvVar = definitions.find(d => d.redisEnvVar)?.redisEnvVar;
        const redisEndpoint = definitions.find(d => d.redisEndpoint)?.redisEndpoint;
        // Build runtime identity
        const runtime = {
            service_name: queueName,
            resource_type: 'queue',
            engine: library,
            ...(redisEnvVar ? { connection_env_var: redisEnvVar } : {}),
            ...(redisEndpoint
                ? {
                    endpoint: {
                        protocol: 'redis',
                        host: redisEndpoint.host,
                        port: redisEndpoint.port,
                    },
                }
                : {}),
        };
        components.push({
            component_id: componentId,
            name: queueName,
            type: 'queue',
            role: {
                purpose: `${library} queue — ${producers.length} producer(s), ${consumers.length} consumer(s)${concurrency ? `, concurrency=${concurrency}` : ''}`,
                layer: 'queue',
                critical: true,
            },
            source: {
                detection_method: 'auto',
                config_files: [...new Set(definitions.map(d => d.file))],
                confidence: 1.0,
            },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: ['queue', library, queueName],
            metadata: {
                library,
                concurrency,
                retryAttempts,
                producerFiles: producers.map(p => p.file),
                consumerFiles: consumers.map(c => c.file),
            },
            runtime,
            timestamp,
            last_updated: timestamp,
        });
        // Create producer -> queue connections
        for (const producer of producers) {
            connections.push({
                connection_id: generateConnectionId('queue-produces'),
                from: {
                    component_id: `FILE:${producer.file}`,
                    location: { file: producer.file, line: producer.line },
                },
                to: {
                    component_id: componentId,
                },
                connection_type: 'queue-produces',
                code_reference: {
                    file: producer.file,
                    symbol: producer.symbol,
                    symbol_type: 'variable',
                    line_start: producer.line,
                },
                description: `${producer.file} produces to queue "${queueName}"`,
                detected_from: 'queue-scanner',
                confidence: 1.0,
                timestamp,
                last_verified: timestamp,
            });
        }
        // Create queue -> consumer connections
        for (const consumer of consumers) {
            connections.push({
                connection_id: generateConnectionId('queue-consumes'),
                from: {
                    component_id: componentId,
                    location: { file: consumer.file, line: consumer.line },
                },
                to: {
                    component_id: `FILE:${consumer.file}`,
                },
                connection_type: 'queue-consumes',
                code_reference: {
                    file: consumer.file,
                    symbol: consumer.symbol,
                    symbol_type: 'variable',
                    line_start: consumer.line,
                },
                description: `Queue "${queueName}" consumed by ${consumer.file}`,
                detected_from: 'queue-scanner',
                confidence: 1.0,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    // Create queue -> Redis/cache connections when connection env var is known
    for (const comp of components) {
        const envVar = comp.runtime?.connection_env_var;
        if (envVar) {
            connections.push({
                connection_id: generateConnectionId('queue-uses-cache'),
                from: {
                    component_id: comp.component_id,
                    location: { file: comp.source.config_files[0] || '', line: 0 },
                },
                to: {
                    component_id: `ENV:${envVar}`,
                    location: { file: '.env', line: 0 },
                },
                connection_type: 'queue-uses-cache',
                code_reference: {
                    file: comp.source.config_files[0] || '',
                    symbol: envVar,
                    symbol_type: 'variable',
                },
                description: `${comp.name} connects to Redis via ${envVar}`,
                detected_from: 'queue-scanner',
                confidence: 0.85,
                timestamp,
                last_verified: timestamp,
            });
        }
    }
    return { components, connections, warnings };
}
/**
 * Detect if project uses any queue library
 */
export function detectQueues(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath))
        return false;
    try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        return !!(allDeps.bullmq || allDeps.bull || allDeps['bee-queue']);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=queue-scanner.js.map