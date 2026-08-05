// AWS Bedrock Runtime: command-object shape, not a `.method(` path. The
// single-line `client.send(new InvokeModelCommand({...}))` form is detected;
// the two-line command-variable form is a known remaining gap (see
// llm-call-tracer.ts SDK_DEFINITIONS comment).
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: 'us-east-1' });

export async function askBedrock(prompt: string) {
  const response = await client.send(new InvokeModelCommand({
    modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    body: JSON.stringify({ prompt }),
    contentType: 'application/json',
  }));
  return response.body;
}
