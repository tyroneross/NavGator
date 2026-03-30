import { describe, it, expect } from 'vitest';
import { categorizeEnvVar } from '../scanners/infrastructure/env-scanner.js';

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
