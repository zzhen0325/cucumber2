alter table public.agent_run_events
  drop constraint if exists agent_run_events_type_check;

alter table public.agent_run_events
  add constraint agent_run_events_type_check
  check (
    type = any (
      array[
        'run.created'::text,
        'input.normalized'::text,
        'run.plan.created'::text,
        'run.step.started'::text,
        'run.step.completed'::text,
        'run.step.failed'::text,
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
