create table if not exists public.agent_knowledge_chunks (
  id text primary key,
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  source_artifact_id text not null references public.agent_artifacts(id) on delete cascade,
  source_node_id text,
  text_excerpt text not null,
  text_excerpt_digest text not null,
  keyword_index text[] not null default '{}'::text[],
  embedding jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint agent_knowledge_chunks_excerpt_digest_check
    check (text_excerpt_digest like 'sha256:%'),
  constraint agent_knowledge_chunks_embedding_object_check
    check (embedding is null or jsonb_typeof(embedding) = 'object'),
  constraint agent_knowledge_chunks_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists agent_knowledge_chunks_artifact_digest_idx
  on public.agent_knowledge_chunks (source_artifact_id, text_excerpt_digest);

create index if not exists agent_knowledge_chunks_project_created_at_idx
  on public.agent_knowledge_chunks (project_id, created_at desc);

create index if not exists agent_knowledge_chunks_project_source_node_idx
  on public.agent_knowledge_chunks (project_id, source_node_id)
  where source_node_id is not null;

create index if not exists agent_knowledge_chunks_project_source_artifact_idx
  on public.agent_knowledge_chunks (project_id, source_artifact_id);

create index if not exists agent_knowledge_chunks_keyword_idx
  on public.agent_knowledge_chunks using gin (keyword_index);

alter table public.agent_knowledge_chunks enable row level security;

drop policy if exists "Server can manage agent knowledge chunks" on public.agent_knowledge_chunks;
create policy "Server can manage agent knowledge chunks"
on public.agent_knowledge_chunks
for all
to service_role
using (true)
with check (true);

revoke all on table public.agent_knowledge_chunks
from anon, authenticated;

grant select, insert, update, delete on table public.agent_knowledge_chunks
to service_role;
