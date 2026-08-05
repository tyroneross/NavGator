// Groq's SDK shares the exact `chat.completions.create` shape that broke
// OpenAI detection — same receiver-regex defect, same fix.
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function askGroq(prompt: string) {
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
  });
  return completion.choices[0].message.content;
}
