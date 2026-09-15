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

function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/%20/g, ' ')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Deduplica citas por título normalizado + página (más agresivo que por chunk id). */
export function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const c of chunks) {
    const page = c.page_start ?? c.page_end ?? null;
    const key = `${normalizeTitle(c.title)}::${page ?? 'np'}`;
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

/** Strong clinical signals that justify a focused one-shot retry. */
const STRONG_TITLE_RE =
  /cervicales|06[_\s-]?cervicales|secuencia[_\s-]?tcs|craneosacr|craniosacr|rodilla|visceral|kinesio|vendaje\s*neuro|\bvnm\b/i;
const STRONG_CONTENT_RE =
  /contraindic|klein|jackson|neurovegetativ|arteria\s*vertebral|test\s*de\s*seguridad|movilizaci[oó]n\s*articular/i;

function chunkIsStronglyRelevant(c: RetrievedChunk): boolean {
  const title = stripAccents(c.title || '');
  const content = stripAccents(c.content || '');
  const path = stripAccents(
    String((c.metadata as { storage_path?: string })?.storage_path || ''),
  );
  if (STRONG_TITLE_RE.test(title) || STRONG_TITLE_RE.test(path)) return true;
  if (STRONG_CONTENT_RE.test(content) || STRONG_CONTENT_RE.test(title)) return true;
  return false;
}

/**
 * Subconjunto relevante (máx. 4) para reintento único tras not-found falso.
 * Ordena por similarity ya boosteada del retrieve.
 */
export function selectBoostedSubset(
  chunks: RetrievedChunk[],
  max = 4,
): RetrievedChunk[] {
  const relevant = chunks.filter(chunkIsStronglyRelevant);
  if (relevant.length === 0) return [];
  return [...relevant]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, max);
}

function shouldRetryWithSubset(
  answer: string,
  chunks: RetrievedChunk[],
): RetrievedChunk[] | null {
  if (!isNotFoundAnswer(answer)) return null;
  if (!chunks.some(chunkIsStronglyRelevant)) return null;
  const subset = selectBoostedSubset(chunks, 4);
  // Solo reintentar si el subconjunto es más estrecho (menos ruido).
  if (subset.length === 0) return null;
  if (subset.length >= chunks.length) return null;
  return subset;
}

async function callModel(
  env: Env,
  userMessage: string,
  chunks: RetrievedChunk[],
): Promise<string> {
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
  return answer || NOT_FOUND_ANSWER;
}

export async function generateAnswer(
  env: Env,
  userMessage: string,
  chunks: RetrievedChunk[],
): Promise<{ answer: string; citations: Citation[] }> {
  if (chunks.length === 0) {
    return { answer: NOT_FOUND_ANSWER, citations: [] };
  }

  let usedChunks = chunks;
  let finalAnswer = await callModel(env, userMessage, usedChunks);

  // One-shot retry: not-found but corpus has strong cervical/contraindic hits.
  const subset = shouldRetryWithSubset(finalAnswer, chunks);
  if (subset) {
    const retryAnswer = await callModel(env, userMessage, subset);
    if (!isNotFoundAnswer(retryAnswer)) {
      finalAnswer = retryAnswer;
      usedChunks = subset;
    }
  }

  // Never show citation chips alongside a not-found answer.
  if (isNotFoundAnswer(finalAnswer)) {
    return { answer: NOT_FOUND_ANSWER, citations: [] };
  }

  return {
    answer: finalAnswer,
    citations: buildCitations(usedChunks),
  };
}
