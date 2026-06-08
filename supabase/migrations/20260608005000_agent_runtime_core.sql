create table if not exists public.agent_runs (
  id text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  run_node_id text not null,
  status text not null,
  input jsonb not null,
  intent jsonb,
  built_context jsonb,
  plan jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  canvas_operations jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  evaluation jsonb,
  trace jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint agent_runs_status_check
    check (
      status = any (
        array[
          'queued'::text,
          'routing'::text,
          'building_context'::text,
          'planning'::text,
          'running'::text,
          'waiting_approval'::text,
          'evaluating'::text,
          'completed'::text,
          'failed'::text,
          'cancelled'::text
        ]
      )
    ),
  constraint agent_runs_input_object_check
    check (jsonb_typeof(input) = 'object'::text),
  constraint agent_runs_artifacts_array_check
    check (jsonb_typeof(artifacts) = 'array'::text),
  constraint agent_runs_canvas_operations_array_check
    check (jsonb_typeof(canvas_operations) = 'array'::text),
  constraint agent_runs_errors_array_check
    check (jsonb_typeof(errors) = 'array'::text),
  constraint agent_runs_trace_object_check
    check (jsonb_typeof(trace) = 'object'::text)
);

create index if not exists agent_runs_project_updated_at_idx
  on public.agent_runs (project_id, updated_at desc);

create index if not exists agent_runs_project_run_node_idx
  on public.agent_runs (project_id, run_node_id);

create table if not exists public.agent_run_steps (
  id text primary key,
  project_id uuid not null references public.agent_projects(id) on delete cascade,
  run_node_id text not null,
  plan_step_id text not null,
  status text not null,
  input jsonb,
  output jsonb,
  error jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint agent_run_steps_status_check
    check (
      status = any (
        array[
          'queued'::text,
          'running'::text,
          'success'::text,
          'failed'::text,
          'skipped'::text,
          'waiting_approval'::text
        ]
      )
    )
);

create index if not exists agent_run_steps_project_run_idx
  on public.agent_run_steps (project_id, run_node_id, plan_step_id);

alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists "Server can manage agent runs" on public.agent_runs;
create policy "Server can manage agent runs"
on public.agent_runs
for all
to service_role
using (true)
with check (true);

drop policy if exists "Server can manage agent run steps" on public.agent_run_steps;
create policy "Server can manage agent run steps"
on public.agent_run_steps
for all
to service_role
using (true)
with check (true);

revoke all on table public.agent_runs
from anon, authenticated;

revoke all on table public.agent_run_steps
from anon, authenticated;

grant select, insert, update, delete on table public.agent_runs
to service_role;

grant select, insert, update, delete on table public.agent_run_steps
to service_role;

alter table public.agent_run_step_events
  drop constraint if exists agent_run_step_events_type_check;

alter table public.agent_run_step_events
  add constraint agent_run_step_events_type_check
  check (
    type = any (
      array[
        'run.created'::text,
        'input.normalized'::text,
        'intent.routed'::text,
        'context.built'::text,
        'plan.created'::text,
        'step.started'::text,
        'tool.input'::text,
        'tool.output'::text,
        'tool.error'::text,
        'retry.attempt'::text,
        'approval.requested'::text,
        'approval.responded'::text,
        'artifact.created'::text,
        'canvas.operation.proposed'::text,
        'canvas.operation.applied'::text,
        'canvas.operation.rejected'::text,
        'graph.patch.proposed'::text,
        'graph.patch.applied'::text,
        'evaluation.completed'::text,
        'run.completed'::text,
        'run.failed'::text
      ]
    )
  );
