// Verifies the `.beta.` catch-all was tightened without losing real
// messages calls. `.beta.messages.create` IS an LLM call and must produce an
// anchor; `.beta.agents.list` is a beta *admin* endpoint (agent CRUD, not a
// model invocation) and must NOT produce one — the loose `/\.beta\./`
// pattern this replaces would have matched both indiscriminately.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function askBeta(prompt: string) {
  const msg = await anthropic.beta.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg;
}

export async function listAgents() {
  // Not an LLM call — must not be detected as one.
  const agents = await anthropic.beta.agents.list({});
  return agents;
}
