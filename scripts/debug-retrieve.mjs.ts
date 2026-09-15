import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { expandQueries, clinicalTokens } from './src/lib/expand.ts';
import { retrieveChunks, filterByMinSimilarity } from './src/lib/retrieve.ts';

const q = 'tecnicas cervicales contraindicaciones';
console.log('expand', expandQueries(q));
console.log('tokens', clinicalTokens(q));

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  MIN_SIMILARITY: process.env.MIN_SIMILARITY || '0.32',
  TOP_K: '6',
};
console.log('url', env.SUPABASE_URL?.slice(0, 40));
const raw = await retrieveChunks(env as any, q, 'escuela');
const filtered = filterByMinSimilarity(raw, 0.32);
console.log('raw', raw.length, 'filtered', filtered.length);
for (const c of filtered.slice(0, 8)) {
  console.log((c.similarity || 0).toFixed(3), c.title, 'p' + c.page_start);
}
