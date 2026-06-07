create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.app_users(id) on delete set null,
  name text not null,
  slug text not null,
  description text not null default '',
  instructions text not null,
  config jsonb not null default '{}'::jsonb,
  source_manifest jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint agent_skills_name_length_check
    check (char_length(btrim(name)) between 1 and 80),
  constraint agent_skills_slug_length_check
    check (char_length(btrim(slug)) between 1 and 80),
  constraint agent_skills_description_length_check
    check (char_length(description) <= 500),
  constraint agent_skills_config_object_check
    check (jsonb_typeof(config) = 'object'::text),
  constraint agent_skills_source_manifest_object_check
    check (jsonb_typeof(source_manifest) = 'object'::text)
);

drop trigger if exists agent_skills_updated_at on public.agent_skills;
create trigger agent_skills_updated_at
before update on public.agent_skills
for each row
execute function public.set_current_timestamp_updated_at();

create index if not exists agent_skills_public_updated_at_idx
  on public.agent_skills (updated_at desc)
  where is_public is true and deleted_at is null;

create index if not exists agent_skills_slug_updated_at_idx
  on public.agent_skills (slug, updated_at desc)
  where is_public is true and deleted_at is null;

create index if not exists agent_skills_owner_user_id_idx
  on public.agent_skills (owner_user_id, updated_at desc)
  where deleted_at is null;

alter table public.agent_skills enable row level security;

drop policy if exists "Server can manage agent skills" on public.agent_skills;
create policy "Server can manage agent skills"
on public.agent_skills
for all
to service_role
using (true)
with check (true);

revoke all on table public.agent_skills
from anon, authenticated;

grant select, insert, update, delete on table public.agent_skills
to service_role;
