create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint app_users_username_length_check
    check (char_length(btrim(username)) between 1 and 80)
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now()
);

do $$
begin
  if to_regclass('public.agent_projects') is null
    and to_regclass('public.agent_canvases') is not null then
    alter table public.agent_canvases rename to agent_projects;
  end if;
end $$;

create table if not exists public.agent_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete cascade,
  title text not null default 'Untitled',
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  selected_node_id text,
  last_run_id text,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint agent_projects_nodes_array_check
    check (jsonb_typeof(nodes) = 'array'::text),
  constraint agent_projects_edges_array_check
    check (jsonb_typeof(edges) = 'array'::text)
);

alter table public.agent_projects
  add column if not exists user_id uuid references public.app_users(id) on delete cascade;

alter table public.agent_projects
  add column if not exists deleted_at timestamp with time zone;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_run_events'
      and column_name = 'canvas_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_run_events'
      and column_name = 'project_id'
  ) then
    alter table public.agent_run_events rename column canvas_id to project_id;
  end if;
end $$;

create table if not exists public.agent_run_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  run_node_id text not null,
  prompt text not null,
  selected_node_id text,
  upstream_context jsonb not null default '[]'::jsonb,
  status text not null,
  tool_input jsonb,
  tool_output jsonb,
  error_text text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint agent_run_events_upstream_context_array_check
    check (jsonb_typeof(upstream_context) = 'array'::text),
  constraint agent_run_events_status_check
    check (status = any (array['queued'::text, 'running'::text, 'success'::text, 'error'::text]))
);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'agent_run_events_canvas_id_fkey'
      and conrelid = 'public.agent_run_events'::regclass
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'agent_run_events_project_id_fkey'
      and conrelid = 'public.agent_run_events'::regclass
  ) then
    alter table public.agent_run_events
      rename constraint agent_run_events_canvas_id_fkey to agent_run_events_project_id_fkey;
  end if;
end $$;

drop trigger if exists app_users_updated_at on public.app_users;
create trigger app_users_updated_at
before update on public.app_users
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists agent_canvases_updated_at on public.agent_projects;
drop trigger if exists agent_projects_updated_at on public.agent_projects;
create trigger agent_projects_updated_at
before update on public.agent_projects
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists agent_run_events_updated_at on public.agent_run_events;
create trigger agent_run_events_updated_at
before update on public.agent_run_events
for each row
execute function public.set_current_timestamp_updated_at();

create index if not exists app_sessions_token_hash_idx
  on public.app_sessions (token_hash);

create index if not exists app_sessions_user_id_expires_at_idx
  on public.app_sessions (user_id, expires_at desc);

create index if not exists agent_projects_user_id_updated_at_idx
  on public.agent_projects (user_id, updated_at desc)
  where deleted_at is null;

drop index if exists public.agent_run_events_canvas_id_created_at_idx;

create index if not exists agent_run_events_project_id_created_at_idx
  on public.agent_run_events (project_id, created_at desc);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.agent_projects enable row level security;
alter table public.agent_run_events enable row level security;

drop policy if exists "Server can manage app users" on public.app_users;
create policy "Server can manage app users"
on public.app_users
for all
to service_role
using (true)
with check (true);

drop policy if exists "Server can manage app sessions" on public.app_sessions;
create policy "Server can manage app sessions"
on public.app_sessions
for all
to service_role
using (true)
with check (true);

drop policy if exists "Server can manage agent canvases" on public.agent_projects;
drop policy if exists "Server can manage agent projects" on public.agent_projects;
create policy "Server can manage agent projects"
on public.agent_projects
for all
to service_role
using (true)
with check (true);

drop policy if exists "Server can manage agent run events" on public.agent_run_events;
create policy "Server can manage agent run events"
on public.agent_run_events
for all
to service_role
using (true)
with check (true);

revoke all on table
  public.app_users,
  public.app_sessions,
  public.agent_projects,
  public.agent_run_events
from anon, authenticated;

grant select, insert, update, delete on table
  public.app_users,
  public.app_sessions,
  public.agent_projects,
  public.agent_run_events
to service_role;

revoke all on function public.set_current_timestamp_updated_at()
from public, anon, authenticated;

grant execute on function public.set_current_timestamp_updated_at()
to postgres, service_role;
