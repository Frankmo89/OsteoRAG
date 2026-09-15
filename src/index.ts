/**
 * OsteoRAG Worker — API Hono + assets estáticos.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleChat } from './api/chat';
import type { Env } from './lib/types';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'OsteoRAG',
    note: 'Asistente de estudio — no diagnóstico',
  }),
);

app.post('/api/chat', handleChat);

// Assets: SPA fallback vía wrangler [assets]; rutas API tienen prioridad.
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('OsteoRAG API. UI no enlazada (ASSETS).', 404);
});

export default app;
