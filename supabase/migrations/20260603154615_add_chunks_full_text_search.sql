alter table public.chunks
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(text, ''))) stored;

create index if not exists chunks_search_vector_idx
  on public.chunks using gin (search_vector);
