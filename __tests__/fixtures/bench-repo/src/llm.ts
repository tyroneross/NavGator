import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function summarize(text: string): Promise<string> {
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Summarize the user message in two sentences.' },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
  });
  return r.choices[0]?.message?.content ?? '';
}

export async function classifyTag(content: string): Promise<string[]> {
  const r = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 64,
    messages: [
      { role: 'user', content: `Return 1-5 topic tags as a JSON array for: ${content}` },
    ],
  });
  const block = r.content[0];
  const text = block && 'text' in block ? block.text : '[]';
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}
