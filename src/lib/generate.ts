/**
 * Capa de generación: contexto + system prompt → respuesta + citas.
 */
import { createChatCompletion } from './openai';
import { NOT_FOUND_ANSWER, SYSTEM_PROMPT } from '../prompts/system';
import type { Citation, Env, RetrievedChunk } from './types';

function excerpt(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

export function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const c of chunks) {
    const page = c.page_start ?? c.page_end ?? null;
    const key = `${c.document_id}:${page}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      title: c.title,
      page,
      source_folder: c.source_folder,
      excerpt: excerpt(c.content),
    });
  }
  return citations;
}

export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const pages =
        c.page_start != null && c.page_end != null && c.page_start !== c.page_end
          ? `pp. ${c.page_start}–${c.page_end}`
          : c.page_start != null
            ? `p. ${c.page_start}`
            : 'p. ?';
      return `[#${i + 1}] Título: ${c.title} | Carpeta: ${c.source_folder} | ${pages} | sim=${(c.similarity ?? 0).toFixed(3)}\n${c.content}`;
    })
    .join('\n\n---\n\n');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function isNotFoundAnswer(answer: string): boolean {
  const a = (answer || '').trim();
  if (!a) return true;
  if (a === NOT_FOUND_ANSWER) return true;
  // Model may paraphrase; never attach weak chips to refusals.
  const lower = stripAccents(a.toLowerCase());
  if (lower.includes('no encontre informacion suficiente')) return true;
  if (lower.includes('no encontre') && lower.includes('corpus')) return true;
  if (lower.includes('no encontre') && lower.includes('reformular')) return true;
  if (lower.includes('no encontre informacion') && lower.includes('material')) return true;
  return false;
}

export async function generateAnswer(
  env: Env,
  userMessage: string,
  chunks: RetrievedChunk[],
): Promise<{ answer: string; citations: Citation[] }> {
  if (chunks.length === 0) {
    return { answer: NOT_FOUND_ANSWER, citations: [] };
  }

  const context = formatContext(chunks);
  const userContent = `Pregunta del usuario:\n${userMessage}\n\nFragmentos del corpus (únicos permitidos como fuente):\n${context}`;

  const answer = await createChatCompletion({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.CHAT_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const finalAnswer = answer || NOT_FOUND_ANSWER;
  // Never show citation chips alongside a not-found answer.
  if (isNotFoundAnswer(finalAnswer)) {
    return { answer: NOT_FOUND_ANSWER, citations: [] };
  }

  return {
    answer: finalAnswer,
    citations: buildCitations(chunks),
  };
}
