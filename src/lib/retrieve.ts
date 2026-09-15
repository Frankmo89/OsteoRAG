/**
 * Capa de recuperación: embed query → match_chunks en Supabase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createEmbeddings } from './openai';
import type { Env, FolderFilter, RetrievedChunk } from './types';

export function createServiceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function retrieveChunks(
  env: Env,
  query: string,
  folderFilter: FolderFilter = 'all',
): Promise<RetrievedChunk[]> {
  const topK = Math.max(1, parseInt(env.TOP_K || '6', 10) || 6);
  const [embedding] = await createEmbeddings({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.EMBEDDING_MODEL || 'text-embedding-3-small',
    input: query,
  });

  const supabase = createServiceClient(env);
  const filter =
    !folderFilter || folderFilter === 'all' ? null : folderFilter;

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_count: topK,
    filter_folder: filter,
  });

  if (error) {
    throw new Error(`match_chunks: ${error.message}`);
  }

  return (data ?? []) as RetrievedChunk[];
}

export function filterByMinSimilarity(
  chunks: RetrievedChunk[],
  minSim: number,
): RetrievedChunk[] {
  return chunks.filter((c) => (c.similarity ?? 0) >= minSim);
}
