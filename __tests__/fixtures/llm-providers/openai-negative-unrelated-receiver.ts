// Negative fixture: chat.completions.create() called on an object that is
// NOT a registered OpenAI client. The receiver-regex fix must not trade a
// false negative (the original bug) for a false positive here — OpenAI has
// no allowImportFallback, so an unresolved receiver must simply be skipped.
import OpenAI from 'openai';

// A real client exists in the file (so the file passes the SDK-import gate)
// but it is never called.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// An unrelated object that happens to share OpenAI's method shape.
const otherClient = {
  chat: {
    completions: {
      create: async (_args: unknown) => ({ choices: [] }),
    },
  },
};

export async function notAnLLMCall() {
  const res = await otherClient.chat.completions.create({ model: 'not-a-real-model' });
  return res;
}
