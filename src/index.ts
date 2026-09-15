/**
 * OsteoRAG Worker — API Hono + assets estáticos.
 * Auth: Supabase Bearer JWT (preferido) + Basic opcional de transición.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleChat } from './api/chat';
import {
  appendMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  patchConversation,
} from './api/conversations';
import { handleConfig, requireAuth, type AppEnv } from './lib/auth';

const app = new Hono<AppEnv>();

app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

/** Config pública (URL + anon key) para el login SPA — sin auth. */
app.get('/api/config', handleConfig);

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'OsteoRAG',
    note: 'Asistente de estudio — no diagnóstico',
  }),
);

/** Rutas API protegidas (Bearer o Basic de emergencia). */
app.use('/api/*', requireAuth);

app.post('/api/chat', handleChat);

app.get('/api/conversations', listConversations);
app.post('/api/conversations', createConversation);
app.get('/api/conversations/:id', getConversation);
app.post('/api/conversations/:id/messages', appendMessages);
app.patch('/api/conversations/:id', patchConversation);
app.delete('/api/conversations/:id', deleteConversation);

// Assets: SPA fallback vía wrangler [assets]; rutas API tienen prioridad.
// La UI es pública; el login vive en el cliente (supabase-js).
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('OsteoRAG API. UI no enlazada (ASSETS).', 404);
});

export default app;
