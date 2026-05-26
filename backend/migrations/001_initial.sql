create extension if not exists vector;

create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  status text not null default 'pending', -- pending, ready, failed
  created_at timestamptz not null default now()
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal int not null,
  page int,
  text text not null,
  embedding vector(512), -- voyage-3-lite dimension
  created_at timestamptz not null default now()
);

create index chunks_user_doc_idx on chunks(user_id, document_id);
create index chunks_embedding_idx on chunks
  using hnsw (embedding vector_cosine_ops);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  answer text not null,
  rating smallint not null check (rating in (-1, 1)),
  retrieved_chunk_ids uuid[] not null,
  created_at timestamptz not null default now()
);

-- Row Level Security: defense in depth.
-- Even if backend has a bug, users can never see each other's data.
alter table documents enable row level security;
alter table chunks enable row level security;
alter table feedback enable row level security;

create policy "users see own docs" on documents
  for all using (auth.uid() = user_id);
create policy "users see own chunks" on chunks
  for all using (auth.uid() = user_id);
create policy "users see own feedback" on feedback
  for all using (auth.uid() = user_id);

