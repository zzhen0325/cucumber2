-- Agent v1 is intentionally not migrated. Keep only runs that were created by
-- the OpenAI Agents SDK runtime before collapsing the event schema.
delete from public.agent_run_step_events as event
where not exists (
  select 1
  from public.agent_run_step_events as created
  where created.project_id = event.project_id
    and created.run_node_id = event.run_node_id
    and created.type = 'run.created'
    and created.payload ->> 'runtime' = 'openai-agents-sdk'
);

update public.agent_projects as project
set last_run_id = null
where project.last_run_id is not null
  and not exists (
    select 1
    from public.agent_run_step_events as created
    where created.project_id = project.id
      and created.run_node_id = project.last_run_id
      and created.type = 'run.created'
      and created.payload ->> 'runtime' = 'openai-agents-sdk'
  );

drop table if exists public.agent_run_events cascade;
drop table if exists public.agent_run_steps cascade;
drop table if exists public.agent_runs cascade;
drop table if exists public.agent_artifacts cascade;
drop table if exists public.agent_skills cascade;

alter table public.agent_run_step_events
  rename to agent_run_events;

alter table public.agent_run_events
  rename constraint agent_run_step_events_payload_object_check
  to agent_run_events_payload_object_check;

alter table public.agent_run_events
  rename constraint agent_run_step_events_pkey
  to agent_run_events_pkey;

alter table public.agent_run_events
  rename constraint agent_run_step_events_project_id_fkey
  to agent_run_events_project_id_fkey;

alter table public.agent_run_events
  drop constraint if exists agent_run_step_events_type_check;

alter table public.agent_run_events
  add constraint agent_run_events_type_check
  check (
    type = any (
      array[
        'run.created'::text,
        'input.normalized'::text,
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

alter index if exists public.agent_run_step_events_project_run_created_at_idx
  rename to agent_run_events_project_run_created_at_idx;

alter index if exists public.agent_run_step_events_project_type_created_at_idx
  rename to agent_run_events_project_type_created_at_idx;

drop policy if exists "Server can manage agent run step events"
  on public.agent_run_events;
drop policy if exists "Server can manage agent run events"
  on public.agent_run_events;

create policy "Server can manage agent run events"
on public.agent_run_events
for all
to service_role
using (true)
with check (true);

alter table public.agent_run_events enable row level security;

revoke all on table public.agent_run_events
from anon, authenticated;

grant select, insert, update, delete on table public.agent_run_events
to service_role;
