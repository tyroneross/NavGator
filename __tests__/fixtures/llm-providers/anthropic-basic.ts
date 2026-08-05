// Standard Anthropic messages.create — survived the original bug because
// backtracking rescued the receiver capture (`create` isn't in the old
// hand-written alternation), but must still resolve correctly post-fix.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function askClaude(prompt: string) {
  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg;
}
