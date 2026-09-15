/**
 * OsteoRAG Worker — API Hono + assets estáticos.
 */
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { cors } from 'hono/cors';
import { handleChat } from './api/chat';
import type { Env } from './lib/types';

const app = new Hono<{ Bindings: Env }>();

/** Auth HTTP Basic si BASIC_AUTH_USER + BASIC_AUTH_PASS están definidos. */
app.use('*', async (c, next) => {
  const user = c.env.BASIC_AUTH_USER;
  const pass = c.env.BASIC_AUTH_PASS;
  if (!user || !pass) {
    return next();
  }
  // Health / preflight sin auth
  if (c.req.path === '/api/health' || c.req.method === 'OPTIONS') {
    return next();
  }
  const auth = basicAuth({ username: user, password: pass });
  return auth(c, next);
});

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
