import { describe, it, expect } from 'vitest';
import { categorizeEnvVar, parseConnectionUrl } from '../scanners/infrastructure/env-scanner.js';

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
