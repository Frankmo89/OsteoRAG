/**
 * POST /api/chat — retrieve → generate.
 */
import type { Context } from 'hono';
import { generateAnswer } from '../lib/generate';
import { filterByMinSimilarity, retrieveChunks } from '../lib/retrieve';
import { NOT_FOUND_ANSWER } from '../prompts/system';
import type {
  ChatRequestBody,
  ChatResponseBody,
  Env,
  FolderFilter,
} from '../lib/types';

const VALID_FILTERS = new Set<FolderFilter>([
  'escuela',
  'libros',
  'tesis',
  'all',
]);

export async function handleChat(c: Context<{ Bindings: Env }>) {
  let body: ChatRequestBody;
  try {
    body = await c.req.json<ChatRequestBody>();
  } catch {
    return c.json({ error: 'JSON inválido' }, 400);
  }

  const message = (body.message || '').trim();
  if (!message) {
    return c.json({ error: 'message es obligatorio' }, 400);
  }
  if (message.length > 4000) {
    return c.json({ error: 'message demasiado largo' }, 400);
  }

  const folderFilter: FolderFilter =
    body.folderFilter && VALID_FILTERS.has(body.folderFilter)
      ? body.folderFilter
      : 'all';

  const env = c.env;
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.OPENAI_API_KEY
  ) {
    return c.json(
      { error: 'Faltan variables de entorno del servidor' },
      500,
    );
  }

  try {
    const raw = await retrieveChunks(env, message, folderFilter);
    // Default ~0.35 — filter weak matches before generate (no weak citation chips).
    const minSim = parseFloat(env.MIN_SIMILARITY || '0.35');
    const chunks = filterByMinSimilarity(
      raw,
      Number.isFinite(minSim) ? minSim : 0.35,
    );

    if (chunks.length === 0) {
      const payload: ChatResponseBody = {
        answer: NOT_FOUND_ANSWER,
        citations: [],
      };
      return c.json(payload);
    }

    const { answer, citations } = await generateAnswer(env, message, chunks);
    const payload: ChatResponseBody = { answer, citations };
    return c.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('chat error', msg);
    return c.json({ error: 'Error al procesar la consulta', detail: msg }, 500);
  }
}
