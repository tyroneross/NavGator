import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanPrismaCalls } from '../scanners/connections/prisma-calls.js';
import { createMockComponent } from './helpers.js';
describe('scanPrismaCalls', () => {
    let fixtureDir;
    const articleComp = createMockComponent({
        name: 'Article',
        type: 'database',
        component_id: 'COMP_database_article_test',
        tags: ['prisma'],
    });
    const userComp = createMockComponent({
        name: 'User',
        type: 'database',
        component_id: 'COMP_database_user_test',
        tags: ['prisma'],
    });
    beforeEach(() => {
        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-prisma-calls-'));
    });
    afterEach(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });
    function writeFile(relativePath, content) {
        const fullPath = path.join(fixtureDir, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
    }
    it('detects prisma.article.findMany and creates api-calls-db connection', async () => {
        writeFile('src/api.ts', `
import { prisma } from '@/lib/prisma';
const articles = await prisma.article.findMany({ take: 10 });
`);
        const result = await scanPrismaCalls(fixtureDir, [articleComp]);
        expect(result.connections.length).toBe(1);
        expect(result.connections[0].connection_type).toBe('api-calls-db');
        expect(result.connections[0].to.component_id).toBe('COMP_database_article_test');
        expect(result.connections[0].description).toContain('Article');
        expect(result.connections[0].description).toContain('findMany');
    });
    it('detects multiple models in same file', async () => {
        writeFile('src/dashboard.ts', `
import { prisma } from '@/lib/prisma';
const articles = await prisma.article.count();
const users = await prisma.user.findMany();
`);
        const result = await scanPrismaCalls(fixtureDir, [articleComp, userComp]);
        expect(result.connections.length).toBe(2);
        const models = result.connections.map(c => c.to.component_id);
        expect(models).toContain('COMP_database_article_test');
        expect(models).toContain('COMP_database_user_test');
    });
    it('maps camelCase to PascalCase model name', async () => {
        writeFile('src/camel.ts', `
const data = await prisma.article.findUnique({ where: { id: 1 } });
`);
        const result = await scanPrismaCalls(fixtureDir, [articleComp]);
        expect(result.connections.length).toBe(1);
        expect(result.connections[0].to.component_id).toBe('COMP_database_article_test');
    });
    it('skips files without prisma references', async () => {
        writeFile('src/utils.ts', `
export function formatDate(d: Date) { return d.toISOString(); }
`);
        const result = await scanPrismaCalls(fixtureDir, [articleComp]);
        // Should find connections from earlier test files but none from utils.ts
        const utilsConns = result.connections.filter(c => c.code_reference.file.includes('utils'));
        expect(utilsConns.length).toBe(0);
    });
    it('creates one connection per unique (file, model) pair', async () => {
        writeFile('src/multi-ops.ts', `
const a = await prisma.article.findMany();
const b = await prisma.article.count();
const c = await prisma.article.create({ data: {} });
`);
        const result = await scanPrismaCalls(fixtureDir, [articleComp]);
        const multiOpsConns = result.connections.filter(c => c.code_reference.file.includes('multi-ops'));
        expect(multiOpsConns.length).toBe(1);
        // Description should list all operations
        expect(multiOpsConns[0].description).toContain('findMany');
        expect(multiOpsConns[0].description).toContain('count');
        expect(multiOpsConns[0].description).toContain('create');
    });
    it('returns empty for no model components', async () => {
        const result = await scanPrismaCalls(fixtureDir, []);
        expect(result.connections.length).toBe(0);
    });
    // Run 3 D2b: code_reference.symbol must preserve source casing so the audit
    // WRONG_ENDPOINT verifier can find the token in the file.
    it('Run 3 preserves source casing in code_reference.symbol (camelCase)', async () => {
        const articleEmbeddingComp = createMockComponent({
            name: 'ArticleEmbedding',
            type: 'database',
            component_id: 'COMP_database_article_embedding_test',
            tags: ['prisma'],
        });
        writeFile('src/embeddings.ts', `
const e = await prisma.articleEmbedding.findUnique({ where: { id: 1 } });
`);
        const result = await scanPrismaCalls(fixtureDir, [articleEmbeddingComp]);
        expect(result.connections.length).toBe(1);
        // The stored symbol must match the source casing, not the lowercased key.
        expect(result.connections[0].code_reference.symbol).toBe('prisma.articleEmbedding');
        expect(result.connections[0].code_reference.symbol).not.toBe('prisma.articleembedding');
    });
    it('Run 3 first-seen casing wins when same model appears multiple times', async () => {
        const userComp2 = createMockComponent({
            name: 'User',
            type: 'database',
            component_id: 'COMP_database_user_test',
            tags: ['prisma'],
        });
        writeFile('src/users.ts', `
await prisma.user.findMany();
await prisma.user.count();
`);
        const result = await scanPrismaCalls(fixtureDir, [userComp2]);
        expect(result.connections.length).toBe(1);
        expect(result.connections[0].code_reference.symbol).toBe('prisma.user');
    });
});
//# sourceMappingURL=prisma-calls.test.js.map