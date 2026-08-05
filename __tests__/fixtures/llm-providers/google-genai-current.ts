// Current Google SDK (@google/genai, class GoogleGenAI). The receiver of
// `.models.generateContent` is the client variable itself, so this resolves
// through the standard clientVar mechanism.
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function askGemini(prompt: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  });
  return response.text;
}
