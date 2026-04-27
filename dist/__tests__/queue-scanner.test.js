/**
 * Queue Scanner — runtime identity tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanQueues } from '../scanners/infrastructure/queue-scanner.js';
// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
function writeFixture(dir, relPath, content) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
}
function makeProject(dir, workerSrc) {
    writeFixture(dir, 'package.json', JSON.stringify({
        name: 'test-queue-project',
        dependencies: { bullmq: '^4.0.0' },
    }));
    writeFixture(dir, 'src/worker.ts', workerSrc);
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('queue runtime identity', () => {
    let fixtureDir;
    beforeEach(() => {
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-queue-test-'));
    });
    afterEach(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });
    it('captures queue name as service_name', async () => {
        makeProject(fixtureDir, `
import { Worker } from 'bullmq';
const worker = new Worker('email-queue', async (job) => {
  console.log(job.data);
});
`);
        const result = await scanQueues(fixtureDir);
        const queue = result.components.find(c => c.name === 'email-queue');
        expect(queue).toBeDefined();
        expect(queue.runtime?.service_name).toBe('email-queue');
        expect(queue.runtime?.resource_type).toBe('queue');
    });
    it('captures library as engine', async () => {
        makeProject(fixtureDir, `
import { Queue } from 'bullmq';
const q = new Queue('notifications', { connection: { host: 'localhost', port: 6379 } });
`);
        const result = await scanQueues(fixtureDir);
        const queue = result.components.find(c => c.name === 'notifications');
        expect(queue).toBeDefined();
        expect(queue.runtime?.engine).toBe('bullmq');
    });
    it('detects process.env.REDIS_URL as connection_env_var', async () => {
        makeProject(fixtureDir, `
import { Worker } from 'bullmq';
const worker = new Worker('jobs', async (job) => {}, {
  connection: process.env.REDIS_URL,
});
`);
        const result = await scanQueues(fixtureDir);
        const queue = result.components.find(c => c.name === 'jobs');
        expect(queue).toBeDefined();
        expect(queue.runtime?.connection_env_var).toBe('REDIS_URL');
    });
    it('detects inline host/port as endpoint', async () => {
        makeProject(fixtureDir, `
import { Queue } from 'bullmq';
const q = new Queue('uploads', {
  connection: { host: 'redis.railway.internal', port: 6379 },
});
`);
        const result = await scanQueues(fixtureDir);
        const queue = result.components.find(c => c.name === 'uploads');
        expect(queue).toBeDefined();
        expect(queue.runtime?.endpoint?.host).toBe('redis.railway.internal');
        expect(queue.runtime?.endpoint?.port).toBe(6379);
        expect(queue.runtime?.endpoint?.protocol).toBe('redis');
    });
});
//# sourceMappingURL=queue-scanner.test.js.map