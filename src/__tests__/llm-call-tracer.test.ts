/**
 * Regression + coverage tests for the LLM call tracer's receiver-detection
 * defect (Ops Center 6389f2c7): the hand-written receiver regex in Pass 2
 * (`findCallAnchors`) was decoupled from the call-pattern table and silently
 * mis-captured `openai.chat.completions.create(...)` as receiver
 * `"openai.chat"`, so `clientVars.get("openai.chat")` missed and the call
 * was invisible. The fix derives the receiver regex from each CallPattern's
 * own source, so the two can never drift apart again.
 *
 * `shouldExcludeFile()` in the tracer excludes any path containing
 * `/fixtures?/`, `/__tests__/`, or `/test/`. The fixtures for this suite
 * live at `__tests__/fixtures/llm-providers/` — a path that would be
 * silently skipped if scanned in place. So every test here copies the
 * fixture(s) it needs into an `os.tmpdir()` scratch project (a path with
 * none of the excluded segments) and points `traceLLMCalls` at that scratch
 * root, exactly like a real user's project would be scanned.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { traceLLMCalls, type TracedLLMCall } from '../scanners/connections/llm-call-tracer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', '__tests__', 'fixtures', 'llm-providers');

let scratchDir: string;

beforeEach(async () => {
  scratchDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'navgator-llm-tracer-'));
});

afterEach(async () => {
  await fs.promises.rm(scratchDir, { recursive: true, force: true });
});

/** Copy one or more named fixtures (without the .ts extension requirement) into the scratch project. */
async function stageFixtures(...names: string[]): Promise<void> {
  for (const name of names) {
    const src = path.join(FIXTURES_DIR, name);
    const dest = path.join(scratchDir, name);
    await fs.promises.copyFile(src, dest);
  }
}

/** Find the single traced call for a given fixture file name, asserting exactly one anchor was found. */
function findCallFor(calls: TracedLLMCall[], fixtureName: string): TracedLLMCall {
  const matches = calls.filter(c => c.anchor.file === fixtureName);
  expect(matches, `expected exactly one anchor for ${fixtureName}, got ${matches.length}`).toHaveLength(1);
  return matches[0];
}

describe('llm-call-tracer: receiver regex regression (OpenAI/Groq chat.completions.create)', () => {
  it('detects a bare-const OpenAI client (the exact case that failed before the fix)', async () => {
    await stageFixtures('openai-bare-const.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'openai-bare-const.ts');
    expect(call.provider.name).toBe('openai');
    expect(call.anchor.method).toBe('chat.completions.create');
    expect(call.model.value).toBe('gpt-4o');
  });

  it('still detects this.client.chat.completions.create (worked before the fix; must not regress)', async () => {
    await stageFixtures('openai-this-client.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'openai-this-client.ts');
    expect(call.provider.name).toBe('openai');
    expect(call.anchor.method).toBe('chat.completions.create');
    expect(call.provider.clientVariable).toBe('this.client');
    expect(call.model.value).toBe('gpt-4o');
  });

  it('detects Groq chat.completions.create (same receiver-regex defect as OpenAI)', async () => {
    await stageFixtures('groq-basic.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'groq-basic.ts');
    expect(call.provider.name).toBe('groq');
    expect(call.anchor.method).toBe('chat.completions.create');
    expect(call.model.value).toBe('llama-3.3-70b-versatile');
  });

  it('does NOT produce an anchor for chat.completions.create on an unrelated, non-client object (no false positive traded for the false-negative fix)', async () => {
    await stageFixtures('openai-negative-unrelated-receiver.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const matches = calls.filter(c => c.anchor.file === 'openai-negative-unrelated-receiver.ts');
    expect(matches).toHaveLength(0);
  });

  it('detects Anthropic messages.create unaffected by the fix', async () => {
    await stageFixtures('anthropic-basic.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'anthropic-basic.ts');
    expect(call.provider.name).toBe('anthropic');
    expect(call.anchor.method).toBe('messages.create');
    expect(call.model.value).toBe('claude-3-5-sonnet-20241022');
  });
});

describe('llm-call-tracer: receiver-shape gaps closed after independent audit (f7, f3)', () => {
  it('detects optional chaining on the receiver: openai?.chat.completions.create (f7)', async () => {
    await stageFixtures('openai-optional-chaining.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'openai-optional-chaining.ts');
    expect(call.provider.name).toBe('openai');
    expect(call.anchor.method).toBe('chat.completions.create');
    expect(call.provider.clientVariable).toBe('openai');
    expect(call.model.value).toBe('gpt-4o');
  });

  it('pins the namespaced-receiver narrowing: deps.openai.chat.completions.create attributes to the bare "openai" client (f3, intentional — see KNOWN GAPS comment above SDK_DEFINITIONS)', async () => {
    await stageFixtures('openai-namespaced-receiver.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'openai-namespaced-receiver.ts');
    expect(call.provider.name).toBe('openai');
    expect(call.anchor.method).toBe('chat.completions.create');
    expect(call.provider.clientVariable).toBe('openai');
    expect(call.model.value).toBe('gpt-4o');
  });
});

describe('llm-call-tracer: SDK table audit additions', () => {
  it('tightens Anthropic .beta. to messages-only: detects beta.messages.create, does NOT flag beta.agents.list as an LLM call', async () => {
    await stageFixtures('anthropic-beta-tightening.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const matches = calls.filter(c => c.anchor.file === 'anthropic-beta-tightening.ts');
    expect(matches).toHaveLength(1);
    expect(matches[0].anchor.method).toBe('beta.messages.create');
    expect(matches[0].model.value).toBe('claude-opus-4-20250514');
  });

  it('detects Mistral v1 client.chat.complete (v0 /\\.chat\\(/ pattern does not match .chat.complete()', async () => {
    await stageFixtures('mistral-v1.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'mistral-v1.ts');
    expect(call.provider.name).toBe('mistral');
    expect(call.anchor.method).toBe('chat.complete');
    expect(call.model.value).toBe('mistral-large-latest');
  });

  it('detects the current Google SDK (@google/genai): ai.models.generateContent', async () => {
    await stageFixtures('google-genai-current.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'google-genai-current.ts');
    expect(call.provider.name).toBe('google');
    expect(call.anchor.method).toBe('models.generateContent');
    expect(call.model.value).toBe('gemini-2.0-flash');
  });

  it('detects the legacy Google SDK (@google/generative-ai) two-hop shape via the import-fallback gate', async () => {
    await stageFixtures('google-genai-legacy.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'google-genai-legacy.ts');
    expect(call.provider.name).toBe('google');
    expect(call.anchor.method).toBe('generateContent');
    // The receiver ("model") is never a registered client var — confirms
    // the fallback path, not the direct clientVars match, produced this anchor.
    expect(call.provider.clientVariable).toBe('model');
  });

  it('detects Ollama default-singleton import (no `new` required)', async () => {
    await stageFixtures('ollama-singleton.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'ollama-singleton.ts');
    expect(call.provider.name).toBe('ollama');
    expect(call.anchor.method).toBe('chat');
    expect(call.model.value).toBe('llama3.1');
  });

  it('detects AWS Bedrock single-line client.send(new InvokeModelCommand(...))', async () => {
    await stageFixtures('bedrock-invoke.ts');
    const { calls } = await traceLLMCalls(scratchDir);
    const call = findCallFor(calls, 'bedrock-invoke.ts');
    expect(call.provider.name).toBe('bedrock');
    expect(call.anchor.method).toBe('send(InvokeModelCommand)');
  });

  it('detects the full multi-provider project in one pass with the correct total anchor count', async () => {
    const allFixtures = (await fs.promises.readdir(FIXTURES_DIR)).filter(f => f.endsWith('.ts'));
    await stageFixtures(...allFixtures);
    const { calls } = await traceLLMCalls(scratchDir);
    // Every fixture produces exactly one anchor except the deliberate
    // negative fixture, which must produce zero.
    const expectedCount = allFixtures.filter(f => f !== 'openai-negative-unrelated-receiver.ts').length;
    expect(calls).toHaveLength(expectedCount);
    const providers = new Set(calls.map(c => c.provider.name));
    expect(providers).toEqual(new Set(['openai', 'groq', 'anthropic', 'mistral', 'google', 'ollama', 'bedrock']));
  });
});
