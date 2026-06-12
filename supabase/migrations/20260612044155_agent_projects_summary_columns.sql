alter table public.agent_projects
  add column if not exists node_count integer not null default 0,
  add column if not exists image_count integer not null default 0,
  add column if not exists snapshot_bytes integer not null default 0;

alter table public.agent_projects
  disable trigger agent_projects_updated_at;

update public.agent_projects
set
  node_count = jsonb_array_length(nodes),
  image_count = (
    select count(*)::integer
    from jsonb_array_elements(nodes) as node
    where node -> 'data' ->> 'kind' = 'imageResult'
  ),
  snapshot_bytes = octet_length(
    jsonb_build_object('nodes', nodes, 'edges', edges)::text
  );

alter table public.agent_projects
  enable trigger agent_projects_updated_at;

alter table public.agent_projects
  drop constraint if exists agent_projects_node_count_nonnegative_check,
  add constraint agent_projects_node_count_nonnegative_check
    check (node_count >= 0),
  drop constraint if exists agent_projects_image_count_nonnegative_check,
  add constraint agent_projects_image_count_nonnegative_check
    check (image_count >= 0),
  drop constraint if exists agent_projects_snapshot_bytes_nonnegative_check,
  add constraint agent_projects_snapshot_bytes_nonnegative_check
    check (snapshot_bytes >= 0);
