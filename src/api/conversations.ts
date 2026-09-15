/**
 * CRUD historial de chats (Supabase).
 * owner_id = auth user uuid (Bearer) o CHAT_OWNER_ID/'katya' (Basic legado).
 */
import type { Context } from 'hono';
import type { AppEnv } from '../lib/auth';
import { createServiceClient } from '../lib/retrieve';
import type { Citation, FolderFilter } from '../lib/types';

const VALID_FILTERS = new Set<FolderFilter>([
  'escuela',
  'libros',
  'tesis',
  'all',
]);

function ownerId(c: Context<AppEnv>): string {
  try {
    const id = c.get('ownerId');
    if (typeof id === 'string' && id.trim()) return id.trim();
  } catch {
    /* Variables not set (should not happen behind requireAuth) */
  }
  const v = (c.env.CHAT_OWNER_ID || '').trim();
  return v || 'katya';
}

function requireDb(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): string | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return 'Faltan variables de entorno del servidor';
  }
  return null;
}

function titleFromMessage(message: string): string {
  const t = message.trim().replace(/\s+/g, ' ');
  if (t.length <= 60) return t || 'Nueva chat';
  return `${t.slice(0, 57)}…`;
}

/** GET /api/conversations */
export async function listConversations(c: Context<AppEnv>) {
  const missing = requireDb(c.env);
  if (missing) return c.json({ error: missing }, 500);

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, folder_filter, created_at, updated_at')
    .eq('owner_id', ownerId(c))
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('listConversations', error.message);
    return c.json({ error: 'Error al listar chats', detail: error.message }, 500);
  }
  return c.json({ conversations: data || [] });
}

/** POST /api/conversations  { title?, folderFilter? } */
export async function createConversation(c: Context<AppEnv>) {
  const missing = requireDb(c.env);
  if (missing) return c.json({ error: missing }, 500);

  let body: { title?: string; folderFilter?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const folderFilter =
    body.folderFilter && VALID_FILTERS.has(body.folderFilter as FolderFilter)
      ? (body.folderFilter as FolderFilter)
      : 'all';

  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : 'Nueva chat';

  const supabase = createServiceClient(c.env);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      owner_id: ownerId(c),
      title,
      folder_filter: folderFilter,
      created_at: now,
      updated_at: now,
    })
    .select('id, title, folder_filter, created_at, updated_at')
    .single();

  if (error) {
    console.error('createConversation', error.message);
    return c.json({ error: 'Error al crear chat', detail: error.message }, 500);
  }
  return c.json({ conversation: data }, 201);
}

/** GET /api/conversations/:id */
export async function getConversation(c: Context<AppEnv>) {
  const missing = requireDb(c.env);
  if (missing) return c.json({ error: missing }, 500);

  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id obligatorio' }, 400);

  const supabase = createServiceClient(c.env);
  const oid = ownerId(c);

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id, title, folder_filter, created_at, updated_at')
    .eq('id', id)
    .eq('owner_id', oid)
    .maybeSingle();

  if (convErr) {
    console.error('getConversation', convErr.message);
    return c.json({ error: 'Error al cargar chat', detail: convErr.message }, 500);
  }
  if (!conv) return c.json({ error: 'Chat no encontrado' }, 404);

  const { data: messages, error: msgErr } = await supabase
    .from('messages')
    .select('id, role, content, citations, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (msgErr) {
    console.error('getConversation messages', msgErr.message);
    return c.json({ error: 'Error al cargar mensajes', detail: msgErr.message }, 500);
  }

  return c.json({ conversation: conv, messages: messages || [] });
}

type AppendMessage = {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
};

/** POST /api/conversations/:id/messages  { messages: AppendMessage[] } o un solo mensaje */
export async function appendMessages(c: Context<AppEnv>) {
  const missing = requireDb(c.env);
  if (missing) return c.json({ error: missing }, 500);

  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id obligatorio' }, 400);

  let body: {
    messages?: AppendMessage[];
    role?: string;
    content?: string;
    citations?: Citation[] | null;
    title?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON inválido' }, 400);
  }

  let items: AppendMessage[] = [];
  if (Array.isArray(body.messages) && body.messages.length) {
    items = body.messages;
  } else if (body.role && body.content) {
    items = [
      {
        role: body.role as 'user' | 'assistant',
        content: body.content,
        citations: body.citations,
      },
    ];
  } else {
    return c.json({ error: 'messages es obligatorio' }, 400);
  }

  for (const m of items) {
    if (m.role !== 'user' && m.role !== 'assistant') {
      return c.json({ error: 'role inválido (user|assistant)' }, 400);
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      return c.json({ error: 'content obligatorio' }, 400);
    }
    if (m.content.length > 50000) {
      return c.json({ error: 'content demasiado largo' }, 400);
    }
  }

  const supabase = createServiceClient(c.env);
  const oid = ownerId(c);

  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id, title')
    .eq('id', id)
    .eq('owner_id', oid)
    .maybeSingle();

  if (convErr) {
    return c.json({ error: 'Error al verificar chat', detail: convErr.message }, 500);
  }
  if (!conv) return c.json({ error: 'Chat no encontrado' }, 404);

  const rows = items.map((m) => ({
    conversation_id: id,
    role: m.role,
    content: m.content.trim(),
    citations: m.role === 'assistant' ? m.citations ?? null : null,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from('messages')
    .insert(rows)
    .select('id, role, content, citations, created_at');

  if (insErr) {
    console.error('appendMessages', insErr.message);
    return c.json({ error: 'Error al guardar mensajes', detail: insErr.message }, 500);
  }

  const now = new Date().toISOString();
  const patch: { updated_at: string; title?: string } = { updated_at: now };

  // Auto-título si sigue siendo "Nueva chat" y hay mensaje de usuario
  const firstUser = items.find((m) => m.role === 'user');
  if (
    firstUser &&
    (conv.title === 'Nueva chat' || !conv.title) &&
    !body.title
  ) {
    patch.title = titleFromMessage(firstUser.content);
  } else if (typeof body.title === 'string' && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 120);
  }

  await supabase.from('conversations').update(patch).eq('id', id).eq('owner_id', oid);

  return c.json({ messages: inserted || [], conversation: { id, ...patch } }, 201);
}

/** PATCH /api/conversations/:id  { title?, folderFilter? } */
export async function patchConversation(c: Context<AppEnv>) {
  const missing = requireDb(c.env);
  if (missing) return c.json({ error: missing }, 500);

  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id obligatorio' }, 400);

  let body: { title?: string; folderFilter?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON inválido' }, 400);
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.title === 'string' && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 120);
  }
  if (body.folderFilter && VALID_FILTERS.has(body.folderFilter as FolderFilter)) {
    patch.folder_filter = body.folderFilter;
  }
  if (Object.keys(patch).length === 1) {
    return c.json({ error: 'Nada que actualizar' }, 400);
  }

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', id)
    .eq('owner_id', ownerId(c))
    .select('id, title, folder_filter, created_at, updated_at')
    .maybeSingle();

  if (error) {
    return c.json({ error: 'Error al actualizar', detail: error.message }, 500);
  }
  if (!data) return c.json({ error: 'Chat no encontrado' }, 404);
  return c.json({ conversation: data });
}

/** DELETE /api/conversations/:id */
export async function deleteConversation(c: Context<AppEnv>) {
  const missing = requireDb(c.env);
  if (missing) return c.json({ error: missing }, 500);

  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id obligatorio' }, 400);

  const supabase = createServiceClient(c.env);
  const { data, error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)
    .eq('owner_id', ownerId(c))
    .select('id')
    .maybeSingle();

  if (error) {
    return c.json({ error: 'Error al eliminar', detail: error.message }, 500);
  }
  if (!data) return c.json({ error: 'Chat no encontrado' }, 404);
  return c.json({ ok: true, id: data.id });
}
