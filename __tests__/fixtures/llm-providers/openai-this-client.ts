// This shape passed even before the fix: `this.client` fills the receiver
// regex's two-segment budget before reaching `.chat`, so it "accidentally"
// worked. Must keep passing after the fix.
import OpenAI from 'openai';

export class ChatService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async ask(prompt: string) {
    const res = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0].message.content;
  }
}
