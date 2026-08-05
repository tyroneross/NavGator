// @mistralai/mistralai v1.x moved to client.chat.complete(...). The old
// /\.chat\s*\(/ pattern doesn't match this because `.chat` is followed by
// `.complete(`, not `(`.
import { Mistral } from '@mistralai/mistralai';

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY ?? '' });

export async function askMistral(prompt: string) {
  const result = await client.chat.complete({
    model: 'mistral-large-latest',
    messages: [{ role: 'user', content: prompt }],
  });
  return result;
}
