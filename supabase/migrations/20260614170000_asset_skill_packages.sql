insert into storage.buckets (id, name, public, file_size_limit)
values ('agent-skill-packages', 'agent-skill-packages', false, 104857600)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

alter table public.agent_skill_definitions
  drop constraint if exists agent_skill_definitions_package_size_check;

alter table public.agent_skill_definitions
  add constraint agent_skill_definitions_package_size_check
  check (
    package_size_bytes is null
    or (package_size_bytes >= 0 and package_size_bytes <= 104857600)
  );
