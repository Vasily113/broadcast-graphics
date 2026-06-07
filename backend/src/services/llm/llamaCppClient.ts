interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const DEFAULT_BASE_URL = 'http://localhost:8080';

export async function requestLlamaCppJson(messages: ChatMessage[], model?: string): Promise<unknown | null> {
  const baseUrl = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || process.env.LLM_MODEL || 'local-model',
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`llama.cpp request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  return JSON.parse(content);
}
