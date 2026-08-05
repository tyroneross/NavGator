// Legacy Google SDK (@google/generative-ai, class GoogleGenerativeAI).
// Two-hop shape: genAI.getGenerativeModel(...) returns `model`, and
// `model.generateContent(...)` is the actual call site. `model` is never a
// registered ClientInit, so this relies on the allowImportFallback gate.
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function askGeminiLegacy(prompt: string) {
  const result = await model.generateContent(prompt);
  return result.response.text();
}
