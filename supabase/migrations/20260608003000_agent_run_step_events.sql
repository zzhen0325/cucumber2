create table if not exists public.agent_run_step_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  run_node_id text not null,
  step_id text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamp with time zone not null default now(),
  constraint agent_run_step_events_payload_object_check
    check (jsonb_typeof(payload) = 'object'::text),
  constraint agent_run_step_events_type_check
    check (
      type = any (
        array[
          'run.created'::text,
          'step.started'::text,
          'tool.input'::text,
          'tool.output'::text,
          'tool.error'::text,
          'artifact.created'::text,
          'graph.patch.proposed'::text,
          'graph.patch.applied'::text,
          'run.completed'::text,
          'run.failed'::text
        ]
      )
    )
);

create index if not exists agent_run_step_events_project_run_created_at_idx
  on public.agent_run_step_events (project_id, run_node_id, created_at asc);

create index if not exists agent_run_step_events_project_type_created_at_idx
  on public.agent_run_step_events (project_id, type, created_at desc);

alter table public.agent_run_step_events enable row level security;

drop policy if exists "Server can manage agent run step events" on public.agent_run_step_events;
create policy "Server can manage agent run step events"
on public.agent_run_step_events
for all
to service_role
using (true)
with check (true);

revoke all on table public.agent_run_step_events
from anon, authenticated;

grant select, insert, update, delete on table public.agent_run_step_events
to service_role;
