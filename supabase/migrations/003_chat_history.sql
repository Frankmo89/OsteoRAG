-- OsteoRAG: historial de chats en la nube (conversations + messages)
-- Acceso vía Worker con service_role + Basic Auth. RLS deny-all a anon/authenticated.
-- owner_id: identidad compartida simple (env CHAT_OWNER_ID, p.ej. 'katya') hasta Supabase Auth.

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'katya',
  title text not null default 'Nueva chat',
  folder_filter text null
    check (
      folder_filter is null
      or folder_filter in ('escuela', 'libros', 'tesis', 'all')
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_owner_id_idx
  on public.conversations (owner_id);

create index if not exists conversations_owner_updated_idx
  on public.conversations (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  role text not null
    check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at asc);

-- ---------------------------------------------------------------------------
-- RLS stubs (privado): deny-all a anon/authenticated.
-- Worker usa service_role (bypassa RLS).
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_deny_all" on public.conversations;
create policy "conversations_deny_all"
  on public.conversations
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "messages_deny_all" on public.messages;
create policy "messages_deny_all"
  on public.messages
  for all
  to anon, authenticated
  using (false)
  with check (false);

grant all on table public.conversations to service_role;
grant all on table public.messages to service_role;
