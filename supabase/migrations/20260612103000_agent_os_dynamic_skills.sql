insert into storage.buckets (id, name, public, file_size_limit)
values ('agent-skill-packages', 'agent-skill-packages', false, 5242880)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

alter table public.agent_skill_definitions
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists triggers jsonb not null default '{"keywords":[],"canvasKinds":[]}'::jsonb,
  add column if not exists bindings jsonb not null default '{"tools":[],"agents":[]}'::jsonb,
  add column if not exists scripts jsonb not null default '[]'::jsonb,
  add column if not exists package_bucket text,
  add column if not exists package_path text,
  add column if not exists package_sha256 text,
  add column if not exists package_size_bytes bigint;

alter table public.agent_skill_definitions
  drop constraint if exists agent_skill_definitions_scope_check,
  drop constraint if exists agent_skill_definitions_purpose_check,
  drop constraint if exists agent_skill_definitions_tags_array_check,
  drop constraint if exists agent_skill_definitions_triggers_object_check,
  drop constraint if exists agent_skill_definitions_bindings_object_check,
  drop constraint if exists agent_skill_definitions_scripts_array_check,
  drop constraint if exists agent_skill_definitions_package_sha256_check,
  drop constraint if exists agent_skill_definitions_package_size_check,
  drop constraint if exists agent_skill_definitions_package_ref_check,
  add constraint agent_skill_definitions_scope_check
    check (
      char_length(agent_scope) between 1 and 80
      and agent_scope ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,79}$'
    ),
  add constraint agent_skill_definitions_purpose_check
    check (
      char_length(purpose) between 1 and 80
      and purpose ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,79}$'
    ),
  add constraint agent_skill_definitions_tags_array_check
    check (jsonb_typeof(tags) = 'array'::text),
  add constraint agent_skill_definitions_triggers_object_check
    check (jsonb_typeof(triggers) = 'object'::text),
  add constraint agent_skill_definitions_bindings_object_check
    check (jsonb_typeof(bindings) = 'object'::text),
  add constraint agent_skill_definitions_scripts_array_check
    check (jsonb_typeof(scripts) = 'array'::text),
  add constraint agent_skill_definitions_package_sha256_check
    check (
      package_sha256 is null
      or package_sha256 ~ '^[0-9a-f]{64}$'
    ),
  add constraint agent_skill_definitions_package_size_check
    check (
      package_size_bytes is null
      or (package_size_bytes >= 0 and package_size_bytes <= 5242880)
    ),
  add constraint agent_skill_definitions_package_ref_check
    check (
      (
        package_bucket is null
        and package_path is null
        and package_sha256 is null
        and package_size_bytes is null
        and jsonb_array_length(scripts) = 0
      )
      or (
        package_bucket = 'agent-skill-packages'
        and package_path is not null
        and package_sha256 is not null
        and package_size_bytes is not null
      )
    );

create index if not exists agent_skill_definitions_tags_gin_idx
  on public.agent_skill_definitions using gin (tags)
  where deleted_at is null;

create index if not exists agent_skill_definitions_triggers_gin_idx
  on public.agent_skill_definitions using gin (triggers)
  where deleted_at is null;

create index if not exists agent_skill_definitions_bindings_gin_idx
  on public.agent_skill_definitions using gin (bindings)
  where deleted_at is null;

update public.agent_skill_definitions
set
  tags = '["image","prompt","visual"]'::jsonb,
  triggers = '{"keywords":["生成图片","生图","图片","海报","插画","prompt","提示词"],"canvasKinds":["imageResult","image"]}'::jsonb,
  bindings = '{"tools":["expand_image_prompt","generate_image"],"agents":["Cucumber Image Agent"]}'::jsonb
where name = 'imagegen-prompt-expander'
  and deleted_at is null;

alter table public.agent_run_events
  drop constraint if exists agent_run_events_type_check;

alter table public.agent_run_events
  add constraint agent_run_events_type_check
  check (
    type = any (
      array[
        'run.created'::text,
        'input.normalized'::text,
        'skill.retrieved'::text,
        'skill.activated'::text,
        'skill.script.started'::text,
        'skill.script.completed'::text,
        'skill.script.failed'::text,
        'agent.active'::text,
        'handoff.requested'::text,
        'handoff.completed'::text,
        'tool.input'::text,
        'tool.output'::text,
        'tool.error'::text,
        'artifact.created'::text,
        'canvas.operation.proposed'::text,
        'canvas.operation.applied'::text,
        'canvas.operation.rejected'::text,
        'run.completed'::text,
        'run.failed'::text
      ]
    )
  );

drop policy if exists "Server can manage agent skill package objects" on storage.objects;
create policy "Server can manage agent skill package objects"
on storage.objects
for all
to service_role
using (bucket_id = 'agent-skill-packages')
with check (bucket_id = 'agent-skill-packages');
