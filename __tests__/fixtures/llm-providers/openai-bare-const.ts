// Regression fixture: bare-const OpenAI client calling chat.completions.create.
// Before the receiver-regex fix, findCallAnchors captured "openai.chat" as the
// receiver (not "openai"), so clientVars.get("openai.chat") missed and this
// call was invisible to the tracer.
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askOpenAI(prompt: string) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });
  return res.choices[0].message.content;
}
