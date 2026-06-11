-- Optimistic locking for agent_projects to prevent out-of-order overwrites.
alter table public.agent_projects
  add column if not exists version bigint not null default 0;
