update public.agent_skill_definitions
set bindings =
  jsonb_set(
    coalesce(bindings, '{"tools":[],"agents":[]}'::jsonb),
    '{scopes}',
    (
      select coalesce(jsonb_agg(distinct scope order by scope), '[]'::jsonb)
      from (
        select jsonb_array_elements_text(coalesce(bindings->'scopes', '[]'::jsonb)) as scope
        union
        select 'read.skill'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'read_skill_resource'
          or coalesce(bindings->'tools', '[]'::jsonb) ? 'render_visual_style_prompt'
          or coalesce(bindings->'tools', '[]'::jsonb) ? 'activate_skill'
        union
        select 'run.script'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'run_skill_script'
        union
        select 'read.canvas'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'propose_canvas_operations'
        union
        select 'propose.canvas'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'propose_canvas_operations'
        union
        select 'tool.image.prompt'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'expand_image_prompt'
          or coalesce(bindings->'tools', '[]'::jsonb) ? 'render_visual_style_prompt'
        union
        select 'read.artifact'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'generate_image'
          or coalesce(bindings->'tools', '[]'::jsonb) ? 'upscale_image'
        union
        select 'write.artifact'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'generate_image'
          or coalesce(bindings->'tools', '[]'::jsonb) ? 'upscale_image'
        union
        select 'tool.image.generate'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'generate_image'
        union
        select 'tool.image.upscale'
        where coalesce(bindings->'tools', '[]'::jsonb) ? 'upscale_image'
      ) scopes
    )
  )
where deleted_at is null
  and (
    bindings is null
    or not (bindings ? 'scopes')
    or jsonb_typeof(bindings->'scopes') <> 'array'
  );
