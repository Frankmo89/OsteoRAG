/**
 * Cliente mínimo OpenAI-compatible (embeddings + chat).
 * Separado de retrieve / generate para límites claros.
 */

export interface EmbedOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  input: string | string[];
}

export async function createEmbeddings(opts: EmbedOptions): Promise<number[][]> {
  const base = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      input: opts.input,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embeddings API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export async function createChatCompletion(opts: ChatOptions): Promise<string> {
  const base = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content?.trim() ?? '';
}
