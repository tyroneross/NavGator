import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { categorizeEnvVar, parseConnectionUrl, scanEnvVars } from '../scanners/infrastructure/env-scanner.js';
describe('categorizeEnvVar', () => {
    it('categorizes STRIPE_API_KEY as api-key', () => {
        expect(categorizeEnvVar('STRIPE_API_KEY')).toBe('api-key');
    });
    it('categorizes AUTH_TOKEN as auth (AUTH check fires before TOKEN check)', () => {
        // AUTH_TOKEN includes 'AUTH' which matches the auth check on line 138 first
        expect(categorizeEnvVar('AUTH_TOKEN')).toBe('auth');
    });
    it('categorizes MY_SERVICE_TOKEN as api-key', () => {
        // A plain TOKEN that is not AUTH-related and not VERCEL_TOKEN
        expect(categorizeEnvVar('MY_SERVICE_TOKEN')).toBe('api-key');
    });
    // Bug demonstration: VERCEL_API_KEY should be 'infra' but the bug returns 'api-key'
    // because '_KEY' has no VERCEL guard. This test SHOULD FAIL before the fix.
    it('categorizes VERCEL_API_KEY as infra (not api-key)', () => {
        expect(categorizeEnvVar('VERCEL_API_KEY')).toBe('infra');
    });
    it('categorizes VERCEL_TOKEN as infra (not api-key)', () => {
        expect(categorizeEnvVar('VERCEL_TOKEN')).toBe('infra');
    });
    it('categorizes DATABASE_URL as database', () => {
        expect(categorizeEnvVar('DATABASE_URL')).toBe('database');
    });
    it('categorizes NEXT_PUBLIC_APP_URL as infra', () => {
        expect(categorizeEnvVar('NEXT_PUBLIC_APP_URL')).toBe('infra');
    });
    it('categorizes CLERK_SECRET_KEY as auth (SECRET check fires before _KEY check)', () => {
        // CLERK and SECRET both appear in the auth check, so this returns 'auth'
        expect(categorizeEnvVar('CLERK_SECRET_KEY')).toBe('auth');
    });
    it('documents OPENAI_API_KEY as api-key (API_KEY fires before service check)', () => {
        // OPENAI_API_KEY contains 'API_KEY' which matches at line 142 before
        // the 'service' check at line 146. Current (and post-fix) behavior is 'api-key'.
        expect(categorizeEnvVar('OPENAI_API_KEY')).toBe('api-key');
    });
    it('categorizes MY_CUSTOM_VAR as other', () => {
        expect(categorizeEnvVar('MY_CUSTOM_VAR')).toBe('other');
    });
    it('categorizes VERCEL_DEPLOY_TOKEN as infra (not api-key)', () => {
        // TOKEN guard must use !includes('VERCEL'), not just !includes('VERCEL_TOKEN')
        expect(categorizeEnvVar('VERCEL_DEPLOY_TOKEN')).toBe('infra');
    });
});
describe('parseConnectionUrl', () => {
    it('parses postgres URL with credentials', () => {
        const result = parseConnectionUrl('postgres://user:pass@host:5432/dbname');
        expect(result).toEqual({
            protocol: 'postgres',
            host: 'host',
            port: 5432,
            database: 'dbname',
        });
    });
    it('parses redis URL', () => {
        const result = parseConnectionUrl('redis://default:pass@host:6379');
        expect(result).toEqual({
            protocol: 'redis',
            host: 'host',
            port: 6379,
        });
    });
    it('parses redis URL with database number (/0)', () => {
        const result = parseConnectionUrl('redis://default:pass@host:6379/0');
        expect(result).toEqual({
            protocol: 'redis',
            host: 'host',
            port: 6379,
            database: '0',
        });
    });
    it('parses mysql URL', () => {
        const result = parseConnectionUrl('mysql://user:pass@host:3306/db');
        expect(result).toEqual({
            protocol: 'mysql',
            host: 'host',
            port: 3306,
            database: 'db',
        });
    });
    it('parses amqp URL', () => {
        const result = parseConnectionUrl('amqp://user:pass@host:5672');
        expect(result).toEqual({
            protocol: 'amqp',
            host: 'host',
            port: 5672,
        });
    });
    it('parses https URL', () => {
        const result = parseConnectionUrl('https://api.openai.com/v1');
        expect(result).toEqual({
            protocol: 'https',
            host: 'api.openai.com',
            path: '/v1',
        });
    });
    it('strips credentials — no username or password in output', () => {
        const result = parseConnectionUrl('postgres://admin:supersecret@db.example.com:5432/mydb');
        expect(result).toBeDefined();
        const json = JSON.stringify(result);
        expect(json).not.toContain('admin');
        expect(json).not.toContain('supersecret');
    });
    it('handles URL without port', () => {
        const result = parseConnectionUrl('postgres://user:pass@db.railway.internal/mydb');
        expect(result).toEqual({
            protocol: 'postgres',
            host: 'db.railway.internal',
            database: 'mydb',
        });
    });
    it('handles URL without path/database', () => {
        const result = parseConnectionUrl('redis://default:pass@cache.example.com:6379');
        expect(result).toEqual({
            protocol: 'redis',
            host: 'cache.example.com',
            port: 6379,
        });
    });
    it('returns null for non-URL values', () => {
        expect(parseConnectionUrl('just-a-plain-string')).toBeNull();
        expect(parseConnectionUrl('12345')).toBeNull();
        expect(parseConnectionUrl('my-secret-key-abc123')).toBeNull();
    });
    it('returns null for empty string', () => {
        expect(parseConnectionUrl('')).toBeNull();
    });
    it('returns null for unsupported protocols', () => {
        expect(parseConnectionUrl('ftp://example.com/file')).toBeNull();
        expect(parseConnectionUrl('ws://example.com/socket')).toBeNull();
    });
});
// ============================================================================
// Run 3 D1: source-only env vars must NOT produce phantom components
// ============================================================================
describe('scanEnvVars (Run 3 — Option A)', () => {
    let workDir;
    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-env-test-'));
    });
    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });
    it('emits component for env var defined in .env AND referenced in source', async () => {
        fs.writeFileSync(path.join(workDir, '.env'), 'DEFINED_VAR=value\n');
        fs.writeFileSync(path.join(workDir, 'app.ts'), 'const x = process.env.DEFINED_VAR;\n');
        const result = await scanEnvVars(workDir);
        const definedComp = result.components.find(c => c.name === 'DEFINED_VAR');
        expect(definedComp).toBeDefined();
        expect(definedComp.source.config_files).toEqual(['.env']);
        expect(definedComp.source.config_files).not.toContain('runtime-injected');
    });
    it('does NOT emit component for env var referenced only in source', async () => {
        fs.writeFileSync(path.join(workDir, 'app.ts'), 'const x = process.env.SOURCE_ONLY_VAR;\n');
        const result = await scanEnvVars(workDir);
        const sourceOnly = result.components.find(c => c.name === 'SOURCE_ONLY_VAR');
        expect(sourceOnly).toBeUndefined();
    });
    it('does NOT emit env-dependency connection for source-only env var', async () => {
        fs.writeFileSync(path.join(workDir, 'app.ts'), 'const x = process.env.SOURCE_ONLY_VAR;\n');
        const result = await scanEnvVars(workDir);
        const conn = result.connections.find(c => c.code_reference.symbol === 'process.env.SOURCE_ONLY_VAR');
        expect(conn).toBeUndefined();
    });
    it('still emits a warning for source-only env var (not silently dropped)', async () => {
        fs.writeFileSync(path.join(workDir, 'app.ts'), 'const x = process.env.SOURCE_ONLY_VAR;\n');
        const result = await scanEnvVars(workDir);
        const warning = result.warnings.find(w => w.message.includes('SOURCE_ONLY_VAR') &&
            w.message.includes('not defined in any .env file'));
        expect(warning).toBeDefined();
    });
    it('audit invariant: no emitted env component has placeholder config_files', async () => {
        fs.writeFileSync(path.join(workDir, '.env'), 'A_VAR=v\nB_VAR=v\n');
        fs.writeFileSync(path.join(workDir, 'app.ts'), 'const a=process.env.A_VAR; const b=process.env.B_VAR; const c=process.env.RUNTIME_C;\n');
        const result = await scanEnvVars(workDir);
        for (const c of result.components) {
            // No emitted component should ever carry the legacy placeholder.
            expect(c.source.config_files).not.toContain('runtime-injected');
            // And every config_file must be a real entry on disk (or the test catches it).
            for (const f of c.source.config_files ?? []) {
                const abs = path.join(workDir, f);
                expect(fs.existsSync(abs)).toBe(true);
            }
        }
    });
});
//# sourceMappingURL=env-scanner.test.js.map