/**
 * Tests: deploy-scanner runtime identity enrichment
 * Verifies that `runtime` is populated correctly for each platform.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanDeployConfig } from '../scanners/infrastructure/deploy-scanner.js';

function writeFixture(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Railway
// ---------------------------------------------------------------------------

describe('deploy-scanner: Railway runtime identity', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-railway-'));
    writeFixture(fixtureDir, 'railway.json', JSON.stringify({
      deploy: { startCommand: 'node server.js' },
    }, null, 2));
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('populates runtime.platform as railway', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('railway'));
    expect(comp).toBeDefined();
    expect(comp!.runtime).toBeDefined();
    expect(comp!.runtime!.platform).toBe('railway');
  });

  it('sets resource_type to api for web service', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('railway'));
    expect(comp!.runtime!.resource_type).toBe('api');
  });

  it('sets service_name to main (default for single deploy block)', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('railway'));
    expect(comp!.runtime!.service_name).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// Vercel — without name field
// ---------------------------------------------------------------------------

describe('deploy-scanner: Vercel runtime identity (no name field)', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-vercel-'));
    writeFixture(fixtureDir, 'vercel.json', JSON.stringify({
      buildCommand: 'npm run build',
    }, null, 2));
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('populates runtime.platform as vercel', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('vercel'));
    expect(comp).toBeDefined();
    expect(comp!.runtime!.platform).toBe('vercel');
  });

  it('falls back to vercel-app for service_name when name absent', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('vercel'));
    expect(comp!.runtime!.service_name).toBe('vercel-app');
  });

  it('sets resource_type to api', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('vercel'));
    expect(comp!.runtime!.resource_type).toBe('api');
  });
});

// ---------------------------------------------------------------------------
// Vercel — with name field
// ---------------------------------------------------------------------------

describe('deploy-scanner: Vercel runtime identity (with name field)', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-vercel-named-'));
    writeFixture(fixtureDir, 'vercel.json', JSON.stringify({
      name: 'my-saas-app',
      buildCommand: 'npm run build',
    }, null, 2));
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('uses the name field as service_name', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.name.toLowerCase().includes('vercel'));
    expect(comp).toBeDefined();
    expect(comp!.runtime!.service_name).toBe('my-saas-app');
  });
});

// ---------------------------------------------------------------------------
// Procfile (Heroku)
// ---------------------------------------------------------------------------

describe('deploy-scanner: Procfile runtime identity', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-procfile-'));
    writeFixture(fixtureDir, 'Procfile', [
      'web: node server.js',
      'worker: node worker.js',
    ].join('\n'));
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('creates one component per Procfile dyno', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const herokuComps = result.components.filter(c =>
      c.runtime?.platform === 'heroku'
    );
    expect(herokuComps.length).toBe(2);
  });

  it('web dyno gets resource_type api', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const webComp = result.components.find(c =>
      c.runtime?.platform === 'heroku' && c.runtime.service_name === 'web'
    );
    expect(webComp).toBeDefined();
    expect(webComp!.runtime!.resource_type).toBe('api');
  });

  it('worker dyno gets resource_type worker', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const workerComp = result.components.find(c =>
      c.runtime?.platform === 'heroku' && c.runtime.service_name === 'worker'
    );
    expect(workerComp).toBeDefined();
    expect(workerComp!.runtime!.resource_type).toBe('worker');
  });
});

// ---------------------------------------------------------------------------
// Nixpacks
// ---------------------------------------------------------------------------

describe('deploy-scanner: Nixpacks runtime identity', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-nixpacks-'));
    writeFixture(fixtureDir, 'nixpacks.toml', `
[phases.build]
cmds = ["npm run build"]

[start]
cmd = "node server.js"
`);
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('populates runtime.platform as nixpacks', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.runtime?.platform === 'nixpacks');
    expect(comp).toBeDefined();
    expect(comp!.runtime!.platform).toBe('nixpacks');
  });

  it('sets resource_type to api', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.runtime?.platform === 'nixpacks');
    expect(comp!.runtime!.resource_type).toBe('api');
  });

  it('does not set service_name (no name in nixpacks.toml)', async () => {
    const result = await scanDeployConfig(fixtureDir);
    const comp = result.components.find(c => c.runtime?.platform === 'nixpacks');
    expect(comp!.runtime!.service_name).toBeUndefined();
  });
});
