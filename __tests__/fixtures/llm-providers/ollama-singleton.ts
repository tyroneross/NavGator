// Ollama's default export is an already-usable singleton client — no `new`
// required. Relies on implicitSingletonClient registering the default-import
// binding itself as a client.
import ollama from 'ollama';

export async function askOllama(prompt: string) {
  const response = await ollama.chat({
    model: 'llama3.1',
    messages: [{ role: 'user', content: prompt }],
  });
  return response.message.content;
}
