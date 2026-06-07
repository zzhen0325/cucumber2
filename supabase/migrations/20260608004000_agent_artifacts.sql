create table if not exists public.agent_artifacts (
  id text primary key,
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  run_node_id text not null,
  type text not null,
  uri text,
  title text,
  metadata jsonb not null default '{}'::jsonb,
  content_ref text,
  tool_call_id text,
  source_node_id text,
  created_at timestamp with time zone not null default now(),
  constraint agent_artifacts_type_check
    check (
      type = any (
        array[
          'image'::text,
          'file'::text,
          'doc'::text,
          'code'::text,
          'webpage'::text,
          'dataset'::text,
          'decision'::text,
          'tool_result'::text,
          'memory'::text
        ]
      )
    ),
  constraint agent_artifacts_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'::text)
);

create index if not exists agent_artifacts_project_created_at_idx
  on public.agent_artifacts (project_id, created_at desc);

create index if not exists agent_artifacts_project_run_idx
  on public.agent_artifacts (project_id, run_node_id, created_at asc);

alter table public.agent_artifacts enable row level security;

drop policy if exists "Server can manage agent artifacts" on public.agent_artifacts;
create policy "Server can manage agent artifacts"
on public.agent_artifacts
for all
to service_role
using (true)
with check (true);

revoke all on table public.agent_artifacts
from anon, authenticated;

grant select, insert, update, delete on table public.agent_artifacts
to service_role;
