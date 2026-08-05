// Pins independent-audit finding f3: a namespaced/multi-segment receiver
// (`deps.openai.chat.completions.create(...)`) is captured as the bare
// trailing identifier "openai", not the full "deps.openai" path. See the
// KNOWN GAPS comment above SDK_DEFINITIONS in llm-call-tracer.ts for the
// full recall-vs-precision reasoning behind pinning this as intentional.
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// A namespace object re-exposing the same real client — the common
// dependency-injection shape this behavior is optimized for.
const deps = { openai };

export async function askViaNamespacedDeps(prompt: string) {
  const res = await deps.openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });
  return res.choices[0].message.content;
}
