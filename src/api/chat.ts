/**
 * POST /api/chat — retrieve (multi-query) → generate.
 */
import type { Context } from 'hono';
import { generateAnswer } from '../lib/generate';
import { filterByMinSimilarity, retrieveChunks } from '../lib/retrieve';
import { NOT_FOUND_ANSWER } from '../prompts/system';
import type { AppEnv } from '../lib/auth';
import type {
  ChatRequestBody,
  ChatResponseBody,
  FolderFilter,
} from '../lib/types';

const VALID_FILTERS = new Set<FolderFilter>([
  'escuela',
  'libros',
  'tesis',
  'all',
]);

/** Tips estáticos ES según filtro activo (cuando retrieve queda vacío). */
function reformulationHints(folderFilter: FolderFilter): string {
  const common = [
    'Prueba términos más clínicos (p. ej. «lumbalgia», «vendaje neuromuscular / VNM», «TCS / craneosacral»).',
    'Incluye la estructura o técnica concreta (p. ej. «músculos flexores de la rodilla», «secuencia TCS»).',
  ];
  const byFolder: Record<FolderFilter, string[]> = {
    escuela: [
      'Con filtro escuela, nombra el tema del apunte (cervicales, rodilla, visceral, Secuencia_TCS).',
    ],
    libros: [
      'Con filtro libros, usa vocabulario de manuales (kinesiotaping, VNM, contraindicaciones). Para linfedema / evidencia de kinesiotape, prueba el filtro Tesis.',
    ],
    tesis: [
      'Con filtro tesis, menciona el tema del trabajo (p. ej. linfedema y kinesiotape).',
    ],
    all: [
      'Si el tema es de un apunte concreto, prueba el filtro escuela / libros / tesis.',
    ],
  };
  const tips = [...common.slice(0, 2), ...byFolder[folderFilter]].slice(0, 3);
  return `\n\nSugerencias para reformular:\n- ${tips.join('\n- ')}`;
}

export async function handleChat(c: Context<AppEnv>) {
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
    // Compromiso 0.32 tras merge multi-query (antes 0.35).
    const minSim = parseFloat(env.MIN_SIMILARITY || '0.32');
    const chunks = filterByMinSimilarity(
      raw,
      Number.isFinite(minSim) ? minSim : 0.32,
    );

    if (chunks.length === 0) {
      const payload: ChatResponseBody = {
        answer: NOT_FOUND_ANSWER + reformulationHints(folderFilter),
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
