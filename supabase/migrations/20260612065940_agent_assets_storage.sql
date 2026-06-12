insert into storage.buckets (id, name, public, file_size_limit)
values ('agent-assets', 'agent-assets', false, 52428800)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create table if not exists public.agent_artifacts (
  id text primary key,
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  run_node_id text,
  type text not null,
  uri text,
  title text,
  metadata jsonb not null default '{}'::jsonb,
  content_ref text,
  tool_call_id text,
  source_node_id text,
  bucket_id text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  origin text not null default 'user_upload',
  created_by uuid references public.app_users(id) on delete set null,
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
  constraint agent_artifacts_origin_check
    check (
      origin = any (
        array[
          'user_upload'::text,
          'seedream_generated'::text
        ]
      )
    ),
  constraint agent_artifacts_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'::text),
  constraint agent_artifacts_size_bytes_check
    check (size_bytes is null or size_bytes >= 0),
  constraint agent_artifacts_storage_ref_check
    check (
      (bucket_id is null and storage_path is null)
      or (bucket_id is not null and storage_path is not null)
    )
);

alter table public.agent_artifacts
  add column if not exists bucket_id text,
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists origin text not null default 'user_upload',
  add column if not exists created_by uuid references public.app_users(id) on delete set null;

alter table public.agent_artifacts
  alter column run_node_id drop not null;

alter table public.agent_artifacts
  drop constraint if exists agent_artifacts_origin_check,
  add constraint agent_artifacts_origin_check
    check (
      origin = any (
        array[
          'user_upload'::text,
          'seedream_generated'::text
        ]
      )
    );

alter table public.agent_artifacts
  drop constraint if exists agent_artifacts_size_bytes_check,
  add constraint agent_artifacts_size_bytes_check
    check (size_bytes is null or size_bytes >= 0);

alter table public.agent_artifacts
  drop constraint if exists agent_artifacts_storage_ref_check,
  add constraint agent_artifacts_storage_ref_check
    check (
      (bucket_id is null and storage_path is null)
      or (bucket_id is not null and storage_path is not null)
    );

create unique index if not exists agent_artifacts_bucket_path_idx
  on public.agent_artifacts (bucket_id, storage_path)
  where bucket_id is not null and storage_path is not null;

create index if not exists agent_artifacts_project_created_at_idx
  on public.agent_artifacts (project_id, created_at desc);

create index if not exists agent_artifacts_project_run_idx
  on public.agent_artifacts (project_id, run_node_id, created_at asc)
  where run_node_id is not null;

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

drop policy if exists "Server can manage agent asset objects" on storage.objects;
create policy "Server can manage agent asset objects"
on storage.objects
for all
to service_role
using (bucket_id = 'agent-assets')
with check (bucket_id = 'agent-assets');
