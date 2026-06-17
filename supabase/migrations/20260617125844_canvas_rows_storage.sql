begin;

-- Development-stage destructive migration: all project/canvas runtime data is
-- test data and is intentionally discarded for the row-storage cutover.
do $$
begin
  if to_regclass('public.agent_knowledge_chunks') is not null then
    execute 'truncate table public.agent_knowledge_chunks cascade';
  end if;
  if to_regclass('public.agent_artifact_contents') is not null then
    execute 'truncate table public.agent_artifact_contents cascade';
  end if;
  if to_regclass('public.agent_artifacts') is not null then
    execute 'truncate table public.agent_artifacts cascade';
  end if;
  if to_regclass('public.agent_run_events') is not null then
    execute 'truncate table public.agent_run_events cascade';
  end if;
  if to_regclass('public.agent_projects') is not null then
    execute 'truncate table public.agent_projects cascade';
  end if;
end $$;

alter table public.agent_projects
  drop constraint if exists agent_projects_nodes_array_check,
  drop constraint if exists agent_projects_edges_array_check,
  drop column if exists nodes,
  drop column if exists edges,
  add column if not exists node_count integer not null default 0,
  add column if not exists edge_count integer not null default 0,
  add column if not exists image_count integer not null default 0,
  add column if not exists snapshot_bytes integer not null default 0;

alter table public.agent_projects
  drop constraint if exists agent_projects_node_count_nonnegative_check,
  add constraint agent_projects_node_count_nonnegative_check
    check (node_count >= 0),
  drop constraint if exists agent_projects_edge_count_nonnegative_check,
  add constraint agent_projects_edge_count_nonnegative_check
    check (edge_count >= 0),
  drop constraint if exists agent_projects_image_count_nonnegative_check,
  add constraint agent_projects_image_count_nonnegative_check
    check (image_count >= 0),
  drop constraint if exists agent_projects_snapshot_bytes_nonnegative_check,
  add constraint agent_projects_snapshot_bytes_nonnegative_check
    check (snapshot_bytes >= 0);

alter table public.agent_artifacts
  add column if not exists summary text,
  add column if not exists preview_text text,
  add column if not exists preview_kind text,
  add column if not exists version bigint not null default 0,
  add column if not exists deleted_at timestamp with time zone,
  add column if not exists updated_at timestamp with time zone not null default now();

drop table if exists public.agent_artifact_contents;
drop table if exists public.agent_canvas_edges;
drop table if exists public.agent_canvas_nodes;

create table public.agent_canvas_nodes (
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  node_id text not null,
  type text,
  kind text not null,
  x double precision not null default 0,
  y double precision not null default 0,
  width double precision,
  height double precision,
  node_json jsonb not null default '{}'::jsonb,
  run_id text,
  source_node_id text,
  version bigint not null default 0,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (project_id, node_id),
  constraint agent_canvas_nodes_node_json_object_check
    check (jsonb_typeof(node_json) = 'object'::text)
);

create table public.agent_canvas_edges (
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  edge_id text not null,
  source_node_id text not null,
  target_node_id text not null,
  type text,
  edge_json jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (project_id, edge_id),
  constraint agent_canvas_edges_edge_json_object_check
    check (jsonb_typeof(edge_json) = 'object'::text)
);

create table public.agent_artifact_contents (
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  artifact_id text not null references public.agent_artifacts(id) on delete cascade,
  content_format text not null,
  mime_type text not null,
  content_text text,
  content_json jsonb,
  plain_text text,
  digest text,
  size_bytes bigint not null default 0,
  version bigint not null default 0,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (project_id, artifact_id),
  constraint agent_artifact_contents_size_bytes_check
    check (size_bytes >= 0)
);

create index agent_canvas_nodes_project_active_idx
  on public.agent_canvas_nodes (project_id, deleted_at);

create index agent_canvas_nodes_project_updated_idx
  on public.agent_canvas_nodes (project_id, updated_at desc);

create index agent_canvas_nodes_project_kind_idx
  on public.agent_canvas_nodes (project_id, kind);

create index agent_canvas_nodes_project_run_idx
  on public.agent_canvas_nodes (project_id, run_id)
  where run_id is not null;

create index agent_canvas_edges_project_active_idx
  on public.agent_canvas_edges (project_id, deleted_at);

create index agent_canvas_edges_source_idx
  on public.agent_canvas_edges (project_id, source_node_id);

create index agent_canvas_edges_target_idx
  on public.agent_canvas_edges (project_id, target_node_id);

create index agent_artifact_contents_project_idx
  on public.agent_artifact_contents (project_id);

create index agent_artifact_contents_updated_idx
  on public.agent_artifact_contents (project_id, updated_at desc);

create index if not exists agent_artifacts_project_active_idx
  on public.agent_artifacts (project_id, deleted_at);

create index if not exists agent_artifacts_project_updated_idx
  on public.agent_artifacts (project_id, updated_at desc);

alter table public.agent_canvas_nodes enable row level security;
alter table public.agent_canvas_edges enable row level security;
alter table public.agent_artifact_contents enable row level security;

drop policy if exists "Server can manage agent canvas nodes" on public.agent_canvas_nodes;
create policy "Server can manage agent canvas nodes"
on public.agent_canvas_nodes
for all
to service_role
using (true)
with check (true);

drop policy if exists "Server can manage agent canvas edges" on public.agent_canvas_edges;
create policy "Server can manage agent canvas edges"
on public.agent_canvas_edges
for all
to service_role
using (true)
with check (true);

drop policy if exists "Server can manage agent artifact contents" on public.agent_artifact_contents;
create policy "Server can manage agent artifact contents"
on public.agent_artifact_contents
for all
to service_role
using (true)
with check (true);

drop trigger if exists agent_canvas_nodes_updated_at on public.agent_canvas_nodes;
create trigger agent_canvas_nodes_updated_at
before update on public.agent_canvas_nodes
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists agent_canvas_edges_updated_at on public.agent_canvas_edges;
create trigger agent_canvas_edges_updated_at
before update on public.agent_canvas_edges
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists agent_artifact_contents_updated_at on public.agent_artifact_contents;
create trigger agent_artifact_contents_updated_at
before update on public.agent_artifact_contents
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists agent_artifacts_updated_at on public.agent_artifacts;
create trigger agent_artifacts_updated_at
before update on public.agent_artifacts
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.apply_canvas_patch(
  p_project_id uuid,
  p_user_id uuid,
  p_expected_version bigint default null,
  p_node_upserts jsonb default '[]'::jsonb,
  p_node_deletes text[] default array[]::text[],
  p_edge_upserts jsonb default '[]'::jsonb,
  p_edge_deletes text[] default array[]::text[],
  p_selected_node_id text default null,
  p_last_run_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.agent_projects%rowtype;
  v_next_version bigint;
  v_now timestamp with time zone := now();
  v_node_count integer := 0;
  v_edge_count integer := 0;
  v_image_count integer := 0;
begin
  select *
  into v_project
  from public.agent_projects
  where id = p_project_id
    and user_id = p_user_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  if p_expected_version is not null and v_project.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;

  insert into public.agent_canvas_nodes (
    project_id,
    node_id,
    type,
    kind,
    x,
    y,
    width,
    height,
    node_json,
    run_id,
    source_node_id,
    deleted_at,
    updated_at
  )
  select
    p_project_id,
    item->>'node_id',
    nullif(item->>'type', ''),
    item->>'kind',
    coalesce((item->>'x')::double precision, 0),
    coalesce((item->>'y')::double precision, 0),
    nullif(item->>'width', '')::double precision,
    nullif(item->>'height', '')::double precision,
    coalesce(item->'node_json', '{}'::jsonb),
    nullif(item->>'run_id', ''),
    nullif(item->>'source_node_id', ''),
    null,
    v_now
  from jsonb_array_elements(coalesce(p_node_upserts, '[]'::jsonb)) as item
  on conflict (project_id, node_id)
  do update set
    type = excluded.type,
    kind = excluded.kind,
    x = excluded.x,
    y = excluded.y,
    width = excluded.width,
    height = excluded.height,
    node_json = excluded.node_json,
    run_id = excluded.run_id,
    source_node_id = excluded.source_node_id,
    deleted_at = null,
    updated_at = v_now,
    version = public.agent_canvas_nodes.version + 1;

  if array_length(p_node_deletes, 1) is not null then
    update public.agent_canvas_nodes
    set deleted_at = v_now,
        updated_at = v_now,
        version = version + 1
    where project_id = p_project_id
      and node_id = any(p_node_deletes)
      and deleted_at is null;
  end if;

  insert into public.agent_canvas_edges (
    project_id,
    edge_id,
    source_node_id,
    target_node_id,
    type,
    edge_json,
    deleted_at,
    updated_at
  )
  select
    p_project_id,
    item->>'edge_id',
    item->>'source_node_id',
    item->>'target_node_id',
    nullif(item->>'type', ''),
    coalesce(item->'edge_json', '{}'::jsonb),
    null,
    v_now
  from jsonb_array_elements(coalesce(p_edge_upserts, '[]'::jsonb)) as item
  on conflict (project_id, edge_id)
  do update set
    source_node_id = excluded.source_node_id,
    target_node_id = excluded.target_node_id,
    type = excluded.type,
    edge_json = excluded.edge_json,
    deleted_at = null,
    updated_at = v_now,
    version = public.agent_canvas_edges.version + 1;

  if array_length(p_edge_deletes, 1) is not null then
    update public.agent_canvas_edges
    set deleted_at = v_now,
        updated_at = v_now,
        version = version + 1
    where project_id = p_project_id
      and edge_id = any(p_edge_deletes)
      and deleted_at is null;
  end if;

  select count(*)::integer
  into v_node_count
  from public.agent_canvas_nodes
  where project_id = p_project_id
    and deleted_at is null;

  select count(*)::integer
  into v_edge_count
  from public.agent_canvas_edges
  where project_id = p_project_id
    and deleted_at is null;

  select count(*)::integer
  into v_image_count
  from public.agent_canvas_nodes
  where project_id = p_project_id
    and kind = 'imageResult'
    and deleted_at is null;

  v_next_version := v_project.version + 1;

  update public.agent_projects
  set
    version = v_next_version,
    selected_node_id = p_selected_node_id,
    last_run_id = p_last_run_id,
    node_count = v_node_count,
    edge_count = v_edge_count,
    image_count = v_image_count,
    snapshot_bytes = 0,
    updated_at = v_now
  where id = p_project_id
    and user_id = p_user_id
    and deleted_at is null;

  return jsonb_build_object(
    'id', p_project_id,
    'title', v_project.title,
    'selectedNodeId', p_selected_node_id,
    'lastRunId', p_last_run_id,
    'version', v_next_version,
    'nodeCount', v_node_count,
    'edgeCount', v_edge_count,
    'imageCount', v_image_count,
    'snapshotBytes', 0,
    'createdAt', v_project.created_at,
    'updatedAt', v_now
  );
end;
$$;

create or replace function public.upsert_text_artifact_content(
  p_project_id uuid,
  p_user_id uuid,
  p_artifact_id text,
  p_expected_version bigint default null,
  p_type text default 'doc',
  p_title text default null,
  p_content_format text default 'text',
  p_mime_type text default 'text/plain',
  p_content_text text default null,
  p_content_json jsonb default null,
  p_plain_text text default null,
  p_summary text default null,
  p_preview_text text default null,
  p_preview_kind text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.agent_projects%rowtype;
  v_artifact public.agent_artifacts%rowtype;
  v_next_version bigint := 0;
  v_now timestamp with time zone := now();
  v_size_bytes bigint := 0;
  v_digest text;
begin
  select *
  into v_project
  from public.agent_projects
  where id = p_project_id
    and user_id = p_user_id
    and deleted_at is null;

  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  select *
  into v_artifact
  from public.agent_artifacts
  where id = p_artifact_id
    and deleted_at is null;

  if found then
    if v_artifact.project_id <> p_project_id then
      raise exception 'artifact_project_mismatch' using errcode = 'P0001';
    end if;
    if p_expected_version is not null and v_artifact.version <> p_expected_version then
      raise exception 'artifact_version_conflict' using errcode = 'P0001';
    end if;
    v_next_version := v_artifact.version + 1;
  end if;

  v_size_bytes :=
    octet_length(coalesce(p_content_text, '')) +
    octet_length(coalesce(p_content_json::text, ''));
  v_digest := md5(coalesce(p_content_text, '') || coalesce(p_content_json::text, ''));

  insert into public.agent_artifacts (
    id,
    project_id,
    run_node_id,
    type,
    uri,
    title,
    metadata,
    content_ref,
    tool_call_id,
    source_node_id,
    bucket_id,
    storage_path,
    mime_type,
    size_bytes,
    origin,
    created_by,
    summary,
    preview_text,
    preview_kind,
    version,
    deleted_at,
    updated_at
  )
  values (
    p_artifact_id,
    p_project_id,
    null,
    p_type,
    null,
    p_title,
    coalesce(p_metadata, '{}'::jsonb),
    null,
    null,
    null,
    null,
    null,
    p_mime_type,
    v_size_bytes,
    'user_upload',
    p_user_id,
    p_summary,
    p_preview_text,
    p_preview_kind,
    v_next_version,
    null,
    v_now
  )
  on conflict (id)
  do update set
    title = excluded.title,
    metadata = excluded.metadata,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    summary = excluded.summary,
    preview_text = excluded.preview_text,
    preview_kind = excluded.preview_kind,
    version = v_next_version,
    deleted_at = null,
    updated_at = v_now;

  insert into public.agent_artifact_contents (
    project_id,
    artifact_id,
    content_format,
    mime_type,
    content_text,
    content_json,
    plain_text,
    digest,
    size_bytes,
    version,
    deleted_at,
    updated_at
  )
  values (
    p_project_id,
    p_artifact_id,
    p_content_format,
    p_mime_type,
    p_content_text,
    p_content_json,
    p_plain_text,
    v_digest,
    v_size_bytes,
    v_next_version,
    null,
    v_now
  )
  on conflict (project_id, artifact_id)
  do update set
    content_format = excluded.content_format,
    mime_type = excluded.mime_type,
    content_text = excluded.content_text,
    content_json = excluded.content_json,
    plain_text = excluded.plain_text,
    digest = excluded.digest,
    size_bytes = excluded.size_bytes,
    version = v_next_version,
    deleted_at = null,
    updated_at = v_now;

  return jsonb_build_object(
    'id', p_artifact_id,
    'type', p_type,
    'title', p_title,
    'summary', p_summary,
    'preview', p_preview_text,
    'previewKind', p_preview_kind,
    'mimeType', p_mime_type,
    'sizeBytes', v_size_bytes,
    'version', v_next_version,
    'updatedAt', v_now
  );
end;
$$;

revoke all on table
  public.agent_canvas_nodes,
  public.agent_canvas_edges,
  public.agent_artifact_contents
from anon, authenticated;

grant select, insert, update, delete on table
  public.agent_canvas_nodes,
  public.agent_canvas_edges,
  public.agent_artifact_contents
to service_role;

revoke all on function public.apply_canvas_patch(
  uuid,
  uuid,
  bigint,
  jsonb,
  text[],
  jsonb,
  text[],
  text,
  text
) from public, anon, authenticated;

revoke all on function public.upsert_text_artifact_content(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.apply_canvas_patch(
  uuid,
  uuid,
  bigint,
  jsonb,
  text[],
  jsonb,
  text[],
  text,
  text
) to service_role;

grant execute on function public.upsert_text_artifact_content(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

commit;
