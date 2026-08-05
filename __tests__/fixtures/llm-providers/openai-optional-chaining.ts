// Regression fixture: optional chaining on the receiver
// (`openai?.chat.completions.create(...)`). Before the `\??` insertion in
// getReceiverRegex, the receiver-capture group could not span the `?.`, so
// this call site produced no match at all and was silently dropped —
// independent-audit finding f7.
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askOpenAIOptional(prompt: string) {
  const res = await openai?.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });
  return res?.choices[0].message.content;
}
