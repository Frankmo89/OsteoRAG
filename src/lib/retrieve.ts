/**
 * Capa de recuperación: expand query → embed+match multi-query → merge por chunk id
 * + pase keyword ligero (hybrid) para tokens clínicos distintivos.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { clinicalTokens, expandQueries } from './expand';
import { createEmbeddings } from './openai';
import type { Env, FolderFilter, RetrievedChunk } from './types';

/** Piso de similitud para hits solo-keyword (sobrevive MIN_SIMILARITY 0.32). */
const KEYWORD_SCORE_BASE = 0.34;
const KEYWORD_SCORE_FLOOR = 0.36;
const KEYWORD_TITLE_BOOST = 0.04;
const KEYWORD_MATCH_COUNT = 8;

export function createServiceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function titlePathBoost(
  row: RetrievedChunk,
  tokens: string[],
): number {
  if (tokens.length === 0) return 0;
  const hay = stripAccents(
    `${row.title || ''} ${String((row.metadata as { storage_path?: string })?.storage_path || '')}`.toLowerCase(),
  );
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(stripAccents(t.toLowerCase()))) hits += 1;
  }
  return hits > 0 ? KEYWORD_TITLE_BOOST + Math.min(hits - 1, 2) * 0.01 : 0;
}

/**
 * Keyword pass: RPC keyword_chunks si existe; si no, ilike cliente sobre chunks.content.
 */
async function keywordSearch(
  supabase: SupabaseClient,
  queryTextRaw: string,
  tokens: string[],
  filter: string | null,
): Promise<RetrievedChunk[]> {
  const queryText = (queryTextRaw || '').trim() || tokens.join(' ');
  if (!queryText && tokens.length === 0) return [];

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'keyword_chunks',
    {
      query_text: queryText,
      match_count: KEYWORD_MATCH_COUNT,
      filter_folder: filter,
    },
  );

  if (!rpcError && Array.isArray(rpcData)) {
    return rpcData as RetrievedChunk[];
  }

  // Fallback cliente: ilike por token (OR), join documents vía filtro
  // Nota: sin RPC aplicada aún; útil en dev / pre-migración.
  if (rpcError) {
    console.warn(
      `keyword_chunks RPC no disponible (${rpcError.message}); usando ilike cliente`,
    );
  }

  const orFilter = tokens
    .slice(0, 6)
    .map((t) => `content.ilike.%${t.replace(/[%_,]/g, '')}%`)
    .join(',');

  let q = supabase
    .from('chunks')
    .select(
      'id, document_id, content, page_start, page_end, metadata, documents!inner(title, source_folder, status, storage_path)',
    )
    .eq('documents.status', 'ready')
    .or(orFilter)
    .limit(KEYWORD_MATCH_COUNT);

  if (filter && filter !== 'all') {
    q = q.eq('documents.source_folder', filter);
  }

  const { data, error } = await q;
  if (error || !data) {
    if (error) console.warn(`keyword ilike: ${error.message}`);
    return [];
  }

  return (data as Array<Record<string, unknown>>).map((row) => {
    const doc = row.documents as {
      title: string;
      source_folder: string;
      storage_path?: string;
    };
    return {
      id: row.id as string,
      document_id: row.document_id as string,
      content: row.content as string,
      page_start: (row.page_start as number | null) ?? null,
      page_end: (row.page_end as number | null) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {
        storage_path: doc.storage_path,
      },
      title: doc.title,
      source_folder: doc.source_folder,
      similarity: KEYWORD_SCORE_BASE,
    } satisfies RetrievedChunk;
  });
}

function mergeKeywordHits(
  byId: Map<string, RetrievedChunk>,
  hits: RetrievedChunk[],
  tokens: string[],
): void {
  for (const row of hits) {
    const boost = titlePathBoost(row, tokens);
    const keywordScore = Math.max(KEYWORD_SCORE_BASE + boost, KEYWORD_SCORE_FLOOR);
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, { ...row, similarity: keywordScore });
    } else {
      // Eleva vector débil al piso keyword; no reduce hits vectoriales fuertes
      byId.set(row.id, {
        ...prev,
        similarity: Math.max(prev.similarity ?? 0, keywordScore),
      });
    }
  }
}

/**
 * Recupera chunks con expansión multi-query + hybrid keyword:
 * embed+match por cada variante → merge por id (max similarity) →
 * keyword pass → topK.
 * El umbral min similarity se aplica después (p.ej. en el handler de chat).
 */

function normalizeDocTitle(title: string): string {
  return stripAccents(title || '')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Boost por overlap de tokens clínicos + diversidad máx. 2 por título. */
function diversifyAndBoost(
  chunks: RetrievedChunk[],
  tokens: string[],
  queries: string[],
  topK: number,
): RetrievedChunk[] {
  const boostTerms = new Set(
    [...tokens, ...queries.flatMap((q) => clinicalTokens(q))].map((t) =>
      stripAccents(t.toLowerCase()),
    ),
  );
  // Preferencia fuerte a títulos de apunte relevantes
  const qJoined = stripAccents(queries.join(' ').toLowerCase());
  const wantsLinf =
    /linfedema|drenaje linf|k-taping.*linf|linfatico|linfático/.test(qJoined);
  const wantsKumbrink =
    /kumbrink|indicaciones? del taping|k-taping method|kinesiology taping teor/.test(
      qJoined,
    );
  const titlePrefer = [
    '06 cervicales',
    'cervicales',
    'secuencia tcs',
    'craneosacral',
    'k taping en el drenaje linfatico',
    'drenaje linfatico',
    'linfedema',
    'kumbrink',
    'kinesiology taping teoria',
  ];

  const scored = chunks.map((c) => {
    let score = c.similarity ?? 0;
    const hay = stripAccents(
      `${c.title || ''} ${c.content || ''}`.toLowerCase(),
    );
    let hits = 0;
    for (const t of boostTerms) {
      if (t.length >= 4 && hay.includes(t)) hits += 1;
    }
    score += Math.min(hits, 8) * 0.015;
    const nt = normalizeDocTitle(c.title);
    if (titlePrefer.some((p) => nt.includes(p))) score += 0.08;
    if (/contraindic|klein|jackson|neurovegetativ|arteria vertebral/.test(hay)) {
      score += 0.06;
    }
    // Prioriza el PDF OCR de linfático / tesis cuando la pregunta es de linfedema
    if (wantsLinf && /linf|drenaje linf/.test(nt + ' ' + hay.slice(0, 400))) {
      score += 0.12;
    }
    if (wantsLinf && /k taping en el drenaje linfatico/.test(nt)) {
      score += 0.1;
    }
    // Preferencia fuerte a Kumbrink / teoría KT cuando la query lo pide
    if (wantsKumbrink && /kumbrink/.test(nt)) {
      score += 0.18;
    }
    if (wantsKumbrink && /kinesiology taping teor/.test(nt)) {
      score += 0.1;
    }
    if (wantsKumbrink && /specific indications|indicaciones|application techniques/.test(hay)) {
      score += 0.06;
    }
    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const perTitle = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const { c, score } of scored) {
    const key = normalizeDocTitle(c.title) || c.document_id;
    const n = perTitle.get(key) || 0;
    if (n >= 2) continue;
    perTitle.set(key, n + 1);
    out.push({ ...c, similarity: score });
    if (out.length >= topK) break;
  }
  return out;
}


export async function retrieveChunks(
  env: Env,
  query: string,
  folderFilter: FolderFilter = 'all',
): Promise<RetrievedChunk[]> {
  const topK = Math.max(1, parseInt(env.TOP_K || '6', 10) || 6);
  const queries = expandQueries(query);
  if (queries.length === 0) return [];

  const embeddings = await createEmbeddings({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.EMBEDDING_MODEL || 'text-embedding-3-small',
    input: queries,
  });

  const supabase = createServiceClient(env);
  const filter =
    !folderFilter || folderFilter === 'all' ? null : folderFilter;

  // Pedir un poco más por query para que el merge tenga margen; cap razonable.
  const matchCount = Math.min(Math.max(topK, topK + 2), 12);

  const results = await Promise.all(
    embeddings.map((embedding) =>
      supabase.rpc('match_chunks', {
        query_embedding: embedding,
        match_count: matchCount,
        filter_folder: filter,
      }),
    ),
  );

  const byId = new Map<string, RetrievedChunk>();
  for (const { data, error } of results) {
    if (error) {
      throw new Error(`match_chunks: ${error.message}`);
    }
    for (const row of (data ?? []) as RetrievedChunk[]) {
      const prev = byId.get(row.id);
      if (!prev || (row.similarity ?? 0) > (prev.similarity ?? 0)) {
        byId.set(row.id, row);
      }
    }
  }

  // Hybrid: keyword pass — tokens de la consulta + parafrasis multi-token
  // (p.ej. "contraindicada movilización cervical" / Klein) para FTS.
  const tokens = clinicalTokens(query);
  const seenTok = new Set(tokens.map((t) => stripAccents(t.toLowerCase())));
  for (const q of queries.slice(1)) {
    for (const t of clinicalTokens(q)) {
      const key = stripAccents(t.toLowerCase());
      if (seenTok.has(key)) continue;
      seenTok.add(key);
      tokens.push(t);
      if (tokens.length >= 10) break;
    }
    if (tokens.length >= 10) break;
  }
  try {
    // Primero FTS con la consulta original (no AND de todos los tokens)
    const kwHits = await keywordSearch(supabase, query, tokens, filter);
    mergeKeywordHits(byId, kwHits, tokens);
    // Parafrasis literales (mejor recall: 06_CERVICALES / Klein / Jackson)
    const phraseQueries = queries.slice(1).slice(0, 3);
    for (const phrase of phraseQueries) {
      const pTokens = clinicalTokens(phrase);
      const phraseHits = await keywordSearch(supabase, phrase, pTokens, filter);
      mergeKeywordHits(byId, phraseHits, pTokens.length ? pTokens : tokens);
    }
    // Autor Kumbrink: FTS de la query ES completa se va a otros PDFs de
    // "indicaciones"; forzar pase corto por autor/título del corpus.
    const qFold = stripAccents(query.toLowerCase());
    if (/kumbrink/.test(qFold) || /indicaciones?\s+del\s+(k-?)?taping/.test(qFold)) {
      const authorQueries = [
        'Kumbrink',
        'kumbrink+-+k-taping',
        'Birgit Kumbrink K-Taping',
      ];
      for (const aq of authorQueries) {
        const aHits = await keywordSearch(supabase, aq, ['Kumbrink', 'kumbrink'], filter);
        mergeKeywordHits(byId, aHits, ['Kumbrink', 'kumbrink', 'taping']);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`keyword hybrid skip: ${msg}`);
  }

  const merged = Array.from(byId.values()).sort(
    (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0),
  );
  return diversifyAndBoost(merged, tokens, queries, topK);
}

export function filterByMinSimilarity(
  chunks: RetrievedChunk[],
  minSim: number,
): RetrievedChunk[] {
  return chunks.filter((c) => (c.similarity ?? 0) >= minSim);
}
