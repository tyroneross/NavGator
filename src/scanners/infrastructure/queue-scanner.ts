/**
 * Queue Scanner
 * Detects BullMQ/Bull queues, workers, and producer-consumer relationships
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureComponent,
  ArchitectureConnection,
  ScanResult,
  ScanWarning,
  generateComponentId,
  generateConnectionId,
} from '../../types.js';

// =============================================================================
// QUEUE DETECTION
// =============================================================================

interface QueueDefinition {
  name: string;              // Queue name string
  file: string;              // File where defined
  line: number;              // Line number
  type: 'producer' | 'consumer' | 'both';
  library: 'bullmq' | 'bull' | 'bee-queue' | 'unknown';
  concurrency?: number;
  retryAttempts?: number;
  symbol: string;            // Variable/function name
  redisEnvVar?: string;      // e.g. "REDIS_URL"
  redisEndpoint?: { host?: string; port?: number };
}

/**
 * Scan source files for queue definitions (new Queue, new Worker, etc.)
 */
async function findQueueDefinitions(
  projectRoot: string
): Promise<{ queues: QueueDefinition[]; warnings: ScanWarning[] }> {
  const queues: QueueDefinition[] = [];
  const warnings: ScanWarning[] = [];

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs}', {
    cwd: projectRoot,
    ignore: [
      '**/node_modules/**', '**/dist/**', '**/build/**',
      '**/.next/**', '**/coverage/**', '**/.git/**',
    ],
  });

  for (const file of sourceFiles) {
    try {
      const content = await fs.promises.readFile(
        path.join(projectRoot, file),
        'utf-8'
      );
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

        // BullMQ: new Worker('name', handler, { concurrency, ... })
        const workerMatch = line.match(/new\s+Worker\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (workerMatch) {
          const concurrency = extractConcurrency(content, i, lines);
          const retryAttempts = extractRetryAttempts(content, i, lines);
          const redisInfo = extractRedisConnection(lines, i);
          queues.push({
            name: workerMatch[1],
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
    } catch {
      // Skip unreadable files
    }
  }

  return { queues, warnings };
}

/**
 * Detect which queue library is being used
 */
function detectQueueLibrary(content: string): QueueDefinition['library'] {
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
function extractConcurrency(content: string, lineIndex: number, lines: string[]): number | undefined {
  // Look within a few lines after the Worker constructor for concurrency
  const context = lines.slice(lineIndex, lineIndex + 10).join('\n');
  const match = context.match(/concurrency\s*[:=]\s*(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Extract retry attempts from Worker options
 */
function extractRetryAttempts(content: string, lineIndex: number, lines: string[]): number | undefined {
  const context = lines.slice(lineIndex, lineIndex + 15).join('\n');
  const match = context.match(/attempts\s*[:=]\s*(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Extract the variable/const name the queue is assigned to
 */
function extractSymbol(line: string, lines: string[], lineIndex: number): string {
  // Check current line: const myQueue = new Queue(...)
  const assignMatch = line.match(/(?:const|let|var|export\s+(?:const|let))\s+(\w+)\s*=/);
  if (assignMatch) return assignMatch[1];

  // Check if it's a class property: this.queue = new Queue(...)
  const propMatch = line.match(/this\.(\w+)\s*=/);
  if (propMatch) return propMatch[1];

  // Check previous line for the variable declaration
  if (lineIndex > 0) {
    const prevLine = lines[lineIndex - 1];
    const prevMatch = prevLine.match(/(?:const|let|var)\s+(\w+)\s*=\s*$/);
    if (prevMatch) return prevMatch[1];
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
function extractRedisConnection(
  lines: string[],
  lineIndex: number
): { redisEnvVar?: string; redisEndpoint?: { host?: string; port?: number } } {
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
export async function scanQueues(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  const { queues, warnings: scanWarnings } = await findQueueDefinitions(projectRoot);
  warnings.push(...scanWarnings);

  if (queues.length === 0) {
    return { components, connections, warnings };
  }

  // Group by queue name to build topology
  const queueMap = new Map<string, QueueDefinition[]>();
  for (const q of queues) {
    const group = queueMap.get(q.name) || [];
    group.push(q);
    queueMap.set(q.name, group);
  }

  const queueComponentMap = new Map<string, string>(); // queueName -> component_id

  for (const [queueName, definitions] of queueMap) {
    if (queueName === '__flow_producer__') continue; // Skip FlowProducer meta-entry

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
      resource_type: 'queue' as const,
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

  return { components, connections, warnings };
}

/**
 * Detect if project uses any queue library
 */
export function detectQueues(projectRoot: string): boolean {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    return !!(allDeps.bullmq || allDeps.bull || allDeps['bee-queue']);
  } catch {
    return false;
  }
}
