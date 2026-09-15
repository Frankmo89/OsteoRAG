-- OsteoRAG: esquema inicial (Postgres + pgvector)
-- Embedding dim por defecto: 1536 (text-embedding-3-small).
-- Si usas otro modelo/dimensión, cambia vector(1536) aquí, en match_chunks,
-- y EMBEDDING_DIM / modelo en .env (ver README).

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_folder text not null
    check (source_folder in ('escuela', 'libros', 'tesis')),
  mime text not null default 'application/pdf',
  drive_file_id text null,
  storage_path text not null,
  page_count integer null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'error')),
  created_at timestamptz not null default now()
);

create unique index if not exists documents_storage_path_uidx
  on public.documents (storage_path);

create index if not exists documents_source_folder_idx
  on public.documents (source_folder);

create index if not exists documents_status_idx
  on public.documents (status);

-- ---------------------------------------------------------------------------
-- chunks
-- ---------------------------------------------------------------------------
create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  content text not null,
  page_start integer null,
  page_end integer null,
  -- Dimensión configurable: por defecto 1536. Ver README.
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chunks_document_id_idx
  on public.chunks (document_id);

-- Índice ANN IVFFlat (cosine). lists ~ sqrt(n); ajustar con corpus grande.
-- Alternativa HNSW (mejor recall, más memoria) — descomentar si se prefiere:
--   create index chunks_embedding_hnsw_idx on public.chunks
--   using hnsw (embedding extensions.vector_cosine_ops)
--   with (m = 16, ef_construction = 64);
create index if not exists chunks_embedding_ivfflat_idx
  on public.chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- RPC: similitud coseno + filtro de carpeta
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 6,
  filter_folder text default null  -- 'escuela'|'libros'|'tesis'|null (=all)
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  page_start integer,
  page_end integer,
  metadata jsonb,
  title text,
  source_folder text,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.page_start,
    c.page_end,
    c.metadata,
    d.title,
    d.source_folder,
    (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'ready'
    and c.embedding is not null
    and (
      filter_folder is null
      or filter_folder = 'all'
      or d.source_folder = filter_folder
    )
  order by c.embedding <=> query_embedding
  limit greatest(coalesce(match_count, 6), 1);
$$;

-- ---------------------------------------------------------------------------
-- RLS stubs (privado): deny-all a anon/authenticated.
-- Worker + ingest usan service_role (bypassa RLS).
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.chunks enable row level security;

drop policy if exists "documents_deny_all" on public.documents;
create policy "documents_deny_all"
  on public.documents
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "chunks_deny_all" on public.chunks;
create policy "chunks_deny_all"
  on public.chunks
  for all
  to anon, authenticated
  using (false)
  with check (false);

grant usage on schema public to anon, authenticated, service_role;
grant all on table public.documents to service_role;
grant all on table public.chunks to service_role;
grant execute on function public.match_chunks(extensions.vector, int, text) to service_role;
