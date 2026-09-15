-- OsteoRAG: keyword / hybrid search RPC (plainto_tsquery spanish + ilike fallback)
-- Aplicar en SQL Editor tras 001_init.sql (o supabase db push).

-- Índice FTS ligero sobre content (spanish). Seguro si ya existe.
create index if not exists chunks_content_fts_idx
  on public.chunks
  using gin (to_tsvector('spanish', content));

create or replace function public.keyword_chunks(
  query_text text,
  match_count int default 8,
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
  with q as (
    select nullif(trim(query_text), '') as qt
  ),
  fts as (
    select
      c.id,
      c.document_id,
      c.content,
      c.page_start,
      c.page_end,
      c.metadata,
      d.title,
      d.source_folder,
      -- Score sintético en rango ~0.34–0.45 (compatible con MIN_SIMILARITY 0.32)
      least(
        0.45::float,
        greatest(
          0.34::float,
          0.34::float + ts_rank_cd(
            to_tsvector('spanish', c.content),
            plainto_tsquery('spanish', (select qt from q))
          )::float
        )
      )
      + case
          when d.title ilike '%' || split_part((select qt from q), ' ', 1) || '%'
            then 0.04::float
          else 0.0::float
        end
      as similarity
    from public.chunks c
    join public.documents d on d.id = c.document_id
    cross join q
    where d.status = 'ready'
      and q.qt is not null
      and to_tsvector('spanish', c.content) @@ plainto_tsquery('spanish', q.qt)
      and (
        filter_folder is null
        or filter_folder = 'all'
        or d.source_folder = filter_folder
      )
    order by similarity desc
    limit greatest(coalesce(match_count, 8), 1)
  ),
  -- Fallback ilike si FTS no devolvió filas (p.ej. tokens raros / sin stemming)
  ilike_fallback as (
    select
      c.id,
      c.document_id,
      c.content,
      c.page_start,
      c.page_end,
      c.metadata,
      d.title,
      d.source_folder,
      0.36::float
      + case
          when lower(d.title) like '%' || lower(split_part((select qt from q), ' ', 1)) || '%'
            then 0.04::float
          else 0.0::float
        end
      as similarity
    from public.chunks c
    join public.documents d on d.id = c.document_id
    cross join q
    where d.status = 'ready'
      and q.qt is not null
      and not exists (select 1 from fts)
      and (
        c.content ilike '%' || split_part(q.qt, ' ', 1) || '%'
        or (
          split_part(q.qt, ' ', 2) <> ''
          and c.content ilike '%' || split_part(q.qt, ' ', 2) || '%'
        )
        or (
          split_part(q.qt, ' ', 3) <> ''
          and c.content ilike '%' || split_part(q.qt, ' ', 3) || '%'
        )
      )
      and (
        filter_folder is null
        or filter_folder = 'all'
        or d.source_folder = filter_folder
      )
    order by
      case
        when lower(d.title) like '%' || lower(split_part(q.qt, ' ', 1)) || '%' then 0
        else 1
      end,
      length(c.content) asc
    limit greatest(coalesce(match_count, 8), 1)
  )
  select * from fts
  union all
  select * from ilike_fallback;
$$;

grant execute on function public.keyword_chunks(text, int, text) to service_role;
