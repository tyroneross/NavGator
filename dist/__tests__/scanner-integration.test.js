/**
 * Integration smoke tests for infrastructure scanners.
 * Creates a temporary fixture directory with known files, runs each scanner,
 * and verifies output shape and key results.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanPrismaSchema } from '../scanners/infrastructure/prisma-scanner.js';
import { scanEnvVars } from '../scanners/infrastructure/env-scanner.js';
import { scanQueues } from '../scanners/infrastructure/queue-scanner.js';
import { scanCronJobs } from '../scanners/infrastructure/cron-scanner.js';
import { scanDeployConfig } from '../scanners/infrastructure/deploy-scanner.js';
// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
function writeFixture(dir, relPath, content) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
}
// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Scanner Integration', () => {
    let fixtureDir;
    beforeAll(() => {
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-test-'));
        // prisma/schema.prisma — User model has @default({}) mid-field to exercise
        // the brace-depth parser (fields after @default({}) must not be dropped).
        writeFixture(fixtureDir, 'prisma/schema.prisma', `
model User {
  id    String @id @default(cuid())
  meta  Json   @default({})
  email String @unique
  name  String?
}

model Post {
  id      String @id
  title   String
  content String
}
`);
        // .env — one of each category
        writeFixture(fixtureDir, '.env', [
            'DATABASE_URL=postgres://localhost/test',
            'VERCEL_API_KEY=vk_123',
            'STRIPE_API_KEY=sk_test_123',
            'MY_CUSTOM_VAR=hello',
        ].join('\n') + '\n');
        // package.json — bullmq in dependencies so queue scanner activates
        writeFixture(fixtureDir, 'package.json', JSON.stringify({
            name: 'test-project',
            dependencies: {
                bullmq: '^5.0.0',
            },
        }, null, 2));
        // vercel.json — one cron entry
        writeFixture(fixtureDir, 'vercel.json', JSON.stringify({
            crons: [
                { path: '/api/cleanup', schedule: '0 0 * * *' },
            ],
        }, null, 2));
        // src/worker.ts — BullMQ Worker so queue scanner can detect it
        writeFixture(fixtureDir, 'src/worker.ts', `
import { Worker } from 'bullmq';

const worker = new Worker('email-queue', async (job) => {
  console.log(job.data);
});
`);
    });
    afterAll(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });
    // -------------------------------------------------------------------------
    // Prisma scanner
    // -------------------------------------------------------------------------
    it('Prisma scanner finds User and Post models', async () => {
        const result = await scanPrismaSchema(fixtureDir);
        expect(result.components.length).toBeGreaterThanOrEqual(2);
        const names = result.components.map(c => c.name);
        expect(names).toContain('User');
        expect(names).toContain('Post');
    });
    it('Prisma scanner includes all fields for User including those after @default({})', async () => {
        const result = await scanPrismaSchema(fixtureDir);
        const userComp = result.components.find(c => c.name === 'User');
        expect(userComp).toBeDefined();
        // User has 4 fields: id, meta, email, name
        // The brace-depth parser must not stop at @default({})
        const fields = userComp.metadata?.fields;
        expect(Array.isArray(fields)).toBe(true);
        const fieldNames = fields.map(f => f.name);
        expect(fieldNames).toContain('id');
        expect(fieldNames).toContain('meta');
        expect(fieldNames).toContain('email');
        expect(fieldNames).toContain('name');
    });
    it('Prisma scanner result has components typed as database', async () => {
        const result = await scanPrismaSchema(fixtureDir);
        for (const comp of result.components) {
            expect(comp.type).toBe('database');
            expect(comp.tags).toContain('prisma');
        }
    });
    it('No self-referencing connections (from_id !== to_id)', async () => {
        const result = await scanPrismaSchema(fixtureDir);
        for (const conn of result.connections) {
            expect(conn.from.component_id).not.toBe(conn.to.component_id);
        }
    });
    // -------------------------------------------------------------------------
    // Env scanner
    // -------------------------------------------------------------------------
    it('Env scanner finds all four fixture variables', async () => {
        const result = await scanEnvVars(fixtureDir);
        expect(result.components.length).toBeGreaterThanOrEqual(4);
        const names = result.components.map(c => c.name);
        expect(names).toContain('DATABASE_URL');
        expect(names).toContain('VERCEL_API_KEY');
        expect(names).toContain('STRIPE_API_KEY');
        expect(names).toContain('MY_CUSTOM_VAR');
    });
    it('Env scanner categorizes VERCEL_API_KEY as infra', async () => {
        const result = await scanEnvVars(fixtureDir);
        const vercelKey = result.components.find(c => c.name === 'VERCEL_API_KEY');
        expect(vercelKey).toBeDefined();
        expect(vercelKey.metadata?.category).toBe('infra');
        expect(vercelKey.tags).toContain('infra');
    });
    it('Env scanner categorizes DATABASE_URL as database', async () => {
        const result = await scanEnvVars(fixtureDir);
        const dbUrl = result.components.find(c => c.name === 'DATABASE_URL');
        expect(dbUrl).toBeDefined();
        expect(dbUrl.metadata?.category).toBe('database');
    });
    it('Env scanner categorizes STRIPE_API_KEY as api-key', async () => {
        const result = await scanEnvVars(fixtureDir);
        const stripeKey = result.components.find(c => c.name === 'STRIPE_API_KEY');
        expect(stripeKey).toBeDefined();
        expect(stripeKey.metadata?.category).toBe('api-key');
    });
    it('Env scanner components are typed as config', async () => {
        const result = await scanEnvVars(fixtureDir);
        for (const comp of result.components) {
            expect(comp.type).toBe('config');
            expect(comp.tags).toContain('env');
        }
    });
    // -------------------------------------------------------------------------
    // Cron scanner
    // -------------------------------------------------------------------------
    it('Cron scanner finds the vercel.json cron entry', async () => {
        const result = await scanCronJobs(fixtureDir);
        expect(result.components.length).toBeGreaterThanOrEqual(1);
        const cronComp = result.components.find(c => c.name === '/api/cleanup');
        expect(cronComp).toBeDefined();
        expect(cronComp.type).toBe('cron');
        expect(cronComp.metadata?.schedule).toBe('0 0 * * *');
        expect(cronComp.metadata?.platform).toBe('vercel');
    });
    it('Cron scanner returns a valid ScanResult shape', async () => {
        const result = await scanCronJobs(fixtureDir);
        expect(result).toHaveProperty('components');
        expect(result).toHaveProperty('connections');
        expect(result).toHaveProperty('warnings');
        expect(Array.isArray(result.components)).toBe(true);
        expect(Array.isArray(result.connections)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
    });
    // -------------------------------------------------------------------------
    // Queue scanner
    // -------------------------------------------------------------------------
    it('Queue scanner does not throw and returns a valid ScanResult shape', async () => {
        const result = await scanQueues(fixtureDir);
        expect(result).toBeDefined();
        expect(result).toHaveProperty('components');
        expect(result).toHaveProperty('connections');
        expect(result).toHaveProperty('warnings');
        expect(Array.isArray(result.components)).toBe(true);
    });
    it('Queue scanner finds the email-queue BullMQ worker', async () => {
        const result = await scanQueues(fixtureDir);
        // src/worker.ts defines: new Worker('email-queue', ...)
        const emailQueue = result.components.find(c => c.name === 'email-queue');
        expect(emailQueue).toBeDefined();
        expect(emailQueue.type).toBe('queue');
        expect(emailQueue.metadata?.library).toBe('bullmq');
    });
    // -------------------------------------------------------------------------
    // Deploy scanner
    // -------------------------------------------------------------------------
    it('Deploy scanner finds the vercel.json deploy config', async () => {
        const result = await scanDeployConfig(fixtureDir);
        expect(result).toBeDefined();
        expect(Array.isArray(result.components)).toBe(true);
        expect(result.components.length).toBeGreaterThanOrEqual(1);
        const vercelConfig = result.components.find(c => c.name.toLowerCase().includes('vercel'));
        expect(vercelConfig).toBeDefined();
        expect(vercelConfig.type).toBe('infra');
    });
    it('Deploy scanner returns no connections (by design)', async () => {
        const result = await scanDeployConfig(fixtureDir);
        expect(Array.isArray(result.connections)).toBe(true);
        expect(result.connections).toHaveLength(0);
    });
});
//# sourceMappingURL=scanner-integration.test.js.map