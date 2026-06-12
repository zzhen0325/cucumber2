create table if not exists public.agent_skill_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  skill_md text not null,
  body text not null,
  frontmatter jsonb not null default '{}'::jsonb,
  agent_scope text not null default 'image',
  purpose text not null default 'prompt_expansion',
  enabled boolean not null default true,
  is_default boolean not null default false,
  source_type text not null default 'manual',
  source_manifest jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint agent_skill_definitions_name_check
    check (
      char_length(name) between 1 and 64
      and name ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
      and name not like '%--%'
    ),
  constraint agent_skill_definitions_description_check
    check (char_length(description) between 1 and 1024),
  constraint agent_skill_definitions_skill_md_check
    check (char_length(btrim(skill_md)) > 0),
  constraint agent_skill_definitions_body_check
    check (char_length(btrim(body)) > 0),
  constraint agent_skill_definitions_frontmatter_object_check
    check (jsonb_typeof(frontmatter) = 'object'::text),
  constraint agent_skill_definitions_scope_check
    check (agent_scope = any (array['image'::text])),
  constraint agent_skill_definitions_purpose_check
    check (purpose = any (array['prompt_expansion'::text])),
  constraint agent_skill_definitions_source_type_check
    check (source_type = any (array['manual'::text, 'zip'::text, 'seed'::text])),
  constraint agent_skill_definitions_source_manifest_object_check
    check (jsonb_typeof(source_manifest) = 'object'::text),
  constraint agent_skill_definitions_default_enabled_check
    check (is_default is false or enabled is true)
);

drop trigger if exists agent_skill_definitions_updated_at
  on public.agent_skill_definitions;
create trigger agent_skill_definitions_updated_at
before update on public.agent_skill_definitions
for each row
execute function public.set_current_timestamp_updated_at();

create unique index if not exists agent_skill_definitions_active_name_idx
  on public.agent_skill_definitions (name)
  where deleted_at is null;

create unique index if not exists agent_skill_definitions_one_default_idx
  on public.agent_skill_definitions (agent_scope, purpose)
  where enabled is true and is_default is true and deleted_at is null;

create index if not exists agent_skill_definitions_scope_purpose_idx
  on public.agent_skill_definitions (agent_scope, purpose, updated_at desc)
  where deleted_at is null;

alter table public.agent_skill_definitions enable row level security;

drop policy if exists "Server can manage agent skill definitions"
  on public.agent_skill_definitions;
create policy "Server can manage agent skill definitions"
on public.agent_skill_definitions
for all
to service_role
using (true)
with check (true);

revoke all on table public.agent_skill_definitions
from anon, authenticated;

grant select, insert, update, delete on table public.agent_skill_definitions
to service_role;

insert into public.agent_skill_definitions (
  name,
  description,
  skill_md,
  body,
  frontmatter,
  agent_scope,
  purpose,
  enabled,
  is_default,
  source_type,
  source_manifest
)
select
  'imagegen-prompt-expander',
  'Expand short visual ideas, keywords, themes, IP character concepts, poster/KV/Banner/UI/cover/illustration/packaging/activity/brand visual requests, or vague image-generation briefs into one polished prompt. Use before generating images when the user provides a compact or underspecified visual request and wants a high-quality prompt for image generation or graphic design execution.',
  $skill$---
name: imagegen-prompt-expander
description: Expand short visual ideas, keywords, themes, IP character concepts, poster/KV/Banner/UI/cover/illustration/packaging/activity/brand visual requests, or vague image-generation briefs into one polished prompt. Use before generating images when the user provides a compact or underspecified visual request and wants a high-quality prompt for image generation or graphic design execution.
---

# Imagegen Prompt Expander

Use this skill to turn the user's brief visual idea into one complete, natural, descriptive prompt suitable for an image generation model or a visual designer.

## Core Output Contract

- Output exactly one prompt.
- Write it as one complete flowing paragraph, not JSON, not a list, not an explanation, and not multiple versions.
- Default to Chinese unless the user explicitly asks for English.
- Preserve the user's original intent, subject, style, use case, colors, material, composition, scene, action, text, brand name, title, or required wording.
- If the user asks to generate an image directly, use the expanded prompt as the prompt passed to the image-generation tool. Do not expose analysis unless the user asks to see the prompt.
- If the user asks only to expand or optimize a prompt, return only the expanded prompt paragraph.

## Expansion Principles

Base every addition on the user's input. Do not add unrelated elements or change the core theme.

Add missing but useful visual information that improves generation stability and design executability:

- Overall art direction, graphic design style, visual mood, and emotional tone.
- Coordinated color system: primary color, secondary color, accent color, warm/cool relationship, and overall visual key. If the user gives colors, preserve and strengthen them first.
- Main subject: type, visual focus, key features, material, texture, volume, pose, action, direction, movement, facial or emotional state, and interaction with light, environment, or supporting elements.
- Supporting elements: include them only to reinforce the main visual, never to steal focus.
- Background and spatial depth: foreground, midground, background, decorative graphics, atmosphere, depth, rhythm, and visual hierarchy.
- Composition and layout: subject position, focal point, balance, negative space, silhouette, gaze path, visual movement, and information distribution.
- Graphic design layout when the use case is a poster, KV, Banner, cover, UI, activity page, brand visual, or packaging: typography style, grid, title area, subtitle or information region, font weight contrast, module relationships, white space, hierarchy, and page order.
- Finishing effects: highlights, shadows, strokes, gradients, masks, translucent overlays, reflections, grain, soft focus, glow, noise, depth of field, 3D volume, or material treatment when useful.

## Text And Branding Rules

- If the user provides exact copy, title text, a brand name, or words that must appear in the image, preserve the original wording exactly.
- If no exact copy is provided, do not invent concrete slogans, titles, brand names, logos, or UI text. Instead describe areas such as "预留醒目的标题区域", "副标题信息区", or "按钮式信息模块".
- Do not invent specific brands, real people, copyrighted characters, logos, commercial marks, or named IP unless the user explicitly provides them.

## Safety And Compliance

If the user's idea is risky, preserve the safe core concept while transforming illegal, hateful, explicit sexual, extremely graphic violent, or privacy-invasive content into a compliant visual expression. Keep the final prompt usable and do not dwell on the refusal unless the user explicitly asks for the unsafe content itself.

## Lemo Rule

If the user's subject includes `lemo` or `Lemo`, treat Lemo as a yellow IP character by default. Do not redefine Lemo's fixed base design, body shape, facial structure, proportions, or original character setting. You may add variable context: pose, action, emotion, clothing, accessories, props, scene interaction, lighting, composition position, visual effects, and atmosphere.

## Internal Structure For The Prompt

Internally organize the paragraph in this order, while keeping the final output as one seamless paragraph:

1. Overall design style, art direction, visual atmosphere, and emotional tone.
2. Color palette and visual key.
3. Main subject and its appearance, material, pose, action, mood, and interaction.
4. Secondary elements and how they support the main visual.
5. Background, depth, spatial layers, decorative graphics, and rhythm.
6. Layout, composition, focal point, negative space, balance, and visual path.
7. Typography, information hierarchy, title area, and module layout when the request is graphic design oriented.
8. Final rendering effects, texture, lighting, shadows, grain, glow, depth, or other finish.$skill$,
  $body$# Imagegen Prompt Expander

Use this skill to turn the user's brief visual idea into one complete, natural, descriptive prompt suitable for an image generation model or a visual designer.

## Core Output Contract

- Output exactly one prompt.
- Write it as one complete flowing paragraph, not JSON, not a list, not an explanation, and not multiple versions.
- Default to Chinese unless the user explicitly asks for English.
- Preserve the user's original intent, subject, style, use case, colors, material, composition, scene, action, text, brand name, title, or required wording.
- If the user asks to generate an image directly, use the expanded prompt as the prompt passed to the image-generation tool. Do not expose analysis unless the user asks to see the prompt.
- If the user asks only to expand or optimize a prompt, return only the expanded prompt paragraph.

## Expansion Principles

Base every addition on the user's input. Do not add unrelated elements or change the core theme.

Add missing but useful visual information that improves generation stability and design executability:

- Overall art direction, graphic design style, visual mood, and emotional tone.
- Coordinated color system: primary color, secondary color, accent color, warm/cool relationship, and overall visual key. If the user gives colors, preserve and strengthen them first.
- Main subject: type, visual focus, key features, material, texture, volume, pose, action, direction, movement, facial or emotional state, and interaction with light, environment, or supporting elements.
- Supporting elements: include them only to reinforce the main visual, never to steal focus.
- Background and spatial depth: foreground, midground, background, decorative graphics, atmosphere, depth, rhythm, and visual hierarchy.
- Composition and layout: subject position, focal point, balance, negative space, silhouette, gaze path, visual movement, and information distribution.
- Graphic design layout when the use case is a poster, KV, Banner, cover, UI, activity page, brand visual, or packaging: typography style, grid, title area, subtitle or information region, font weight contrast, module relationships, white space, hierarchy, and page order.
- Finishing effects: highlights, shadows, strokes, gradients, masks, translucent overlays, reflections, grain, soft focus, glow, noise, depth of field, 3D volume, or material treatment when useful.

## Text And Branding Rules

- If the user provides exact copy, title text, a brand name, or words that must appear in the image, preserve the original wording exactly.
- If no exact copy is provided, do not invent concrete slogans, titles, brand names, logos, commercial marks, or UI text. Instead describe areas such as "预留醒目的标题区域", "副标题信息区", or "按钮式信息模块".
- Do not invent specific brands, real people, copyrighted characters, logos, commercial marks, or named IP unless the user explicitly provides them.

## Safety And Compliance

If the user's idea is risky, preserve the safe core concept while transforming illegal, hateful, explicit sexual, extremely graphic violent, or privacy-invasive content into a compliant visual expression. Keep the final prompt usable and do not dwell on the refusal unless the user explicitly asks for the unsafe content itself.

## Lemo Rule

If the user's subject includes `lemo` or `Lemo`, treat Lemo as a yellow IP character by default. Do not redefine Lemo's fixed base design, body shape, facial structure, proportions, or original character setting. You may add variable context: pose, action, emotion, clothing, accessories, props, scene interaction, lighting, composition position, visual effects, and atmosphere.

## Internal Structure For The Prompt

Internally organize the paragraph in this order, while keeping the final output as one seamless paragraph:

1. Overall design style, art direction, visual atmosphere, and emotional tone.
2. Color palette and visual key.
3. Main subject and its appearance, material, pose, action, mood, and interaction.
4. Secondary elements and how they support the main visual.
5. Background, depth, spatial layers, decorative graphics, and rhythm.
6. Layout, composition, focal point, negative space, balance, and visual path.
7. Typography, information hierarchy, title area, and module layout when the request is graphic design oriented.
8. Final rendering effects, texture, lighting, shadows, grain, glow, depth, or other finish.$body$,
  '{"name":"imagegen-prompt-expander","description":"Expand short visual ideas, keywords, themes, IP character concepts, poster/KV/Banner/UI/cover/illustration/packaging/activity/brand visual requests, or vague image-generation briefs into one polished prompt. Use before generating images when the user provides a compact or underspecified visual request and wants a high-quality prompt for image generation or graphic design execution."}'::jsonb,
  'image',
  'prompt_expansion',
  true,
  true,
  'seed',
  '{"origin":"supabase_migration","fileName":"imagegen-prompt-expander.zip"}'::jsonb
where not exists (
  select 1
  from public.agent_skill_definitions
  where name = 'imagegen-prompt-expander'
    and deleted_at is null
);
