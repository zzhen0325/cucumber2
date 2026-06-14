update public.agent_skill_definitions
set is_default = false
where agent_scope = 'image'
  and purpose = 'prompt_expansion'
  and deleted_at is null;

update public.agent_skill_definitions
set
  description = 'Structured AI image style cookbook based on VigoZhao/AI-Visual-Prompt-Cookbook. Use for image generation, poster, KV, social visual, editorial, collage, doodle, travel, type poster, product ad, thumbnail, fashion, city, and other visual prompt requests when Cucumber should prefer a reusable style.json system over generic prompt expansion.',
  skill_md = $skill$---
name: visual-prompt-cookbook
description: Structured AI image style cookbook based on VigoZhao/AI-Visual-Prompt-Cookbook. Use for image generation, poster, KV, social visual, editorial, collage, doodle, travel, type poster, product ad, thumbnail, fashion, city, and other visual prompt requests when Cucumber should prefer a reusable style.json system over generic prompt expansion.
agent_scope: image
purpose: prompt_expansion
tags:
  - image
  - prompt
  - visual-style
  - cookbook
  - style-json
triggers:
  keywords:
    - 生成图片
    - 生图
    - 图片
    - 海报
    - 插画
    - 视觉
    - KV
    - banner
    - poster
    - prompt
    - style
    - cookbook
    - 提示词
  canvas_kinds:
    - imageResult
    - image
bindings:
  tools:
    - render_visual_style_prompt
    - generate_image
  agents:
    - Cucumber Image Agent
---

# Visual Prompt Cookbook

Prefer this skill over generic image prompt expansion for new image generation. It uses reusable `style.json` systems from AI Visual Prompt Cookbook instead of freeform expansion.

## Flow

1. Choose a style system for the user's visual intent.
2. Call `render_visual_style_prompt` with:
   - `prompt`: the user's original image request or normalized content prompt.
   - `styleSlug`: optional; pass it when the user names a style or the best style is obvious.
   - `aspectRatio`: optional; pass normalized aspect ratio when available.
   - `values`: a map of style variables you can infer from the user request.
3. Pass the returned `prompt` to `generate_image`.
4. Include the returned `negativePrompt` only when the image provider/tool accepts a separate negative prompt; otherwise keep the main prompt as-is.

## Style Choice

Use these families:

- Photo + doodle: social snapshots, lifestyle scenes, playful sticker overlays.
- Zine + collage: music, fashion, maximalist editorial, cutout posters.
- Type posters: bold headlines, campaign graphics, launch visuals, thumbnails.
- Travel + city: destination thumbnails, street scenes, transit, urban diaries.
- Editorial + minimal: cleaner layouts, luxury, fashion, architecture, premium product visuals.

If unsure, call `render_visual_style_prompt` without `styleSlug`; it will choose a suitable bundled style from the user's prompt.

## Variable Rules

Fill variables concretely and preserve exact user text:

- `SUBJECT`: main visual subject.
- `SUBJECT_ACTION`: pose, action, or moment.
- `PRODUCT_OR_PROP`: product, object, tool, food, or prop; use "no prop" if absent.
- `LOCATION`: scene or environment.
- `BACKGROUND_ELEMENTS`: supporting background details.
- `MAIN_TEXT`: exact required headline/copy. If the user did not request text, say "no readable headline; use abstract non-readable graphic marks only".
- `SECONDARY_TEXT`: exact supporting text if supplied, otherwise "no readable secondary text".
- `ACCENT_SYMBOL`: small visual marks such as sparkles, arrows, brackets, seals, lines, or "no accent symbol".
- `WARDROBE_STYLE`: styling for people/characters; use "not applicable" for object-only images.
- `ASPECT_RATIO`: normalized aspect ratio such as `16:9`, `9:16`, or `1:1`.

Do not copy reference-specific people, brands, source text, watermarks, usernames, logos, or source compositions listed in the style system.
$skill$,
  body = $body$# Visual Prompt Cookbook

Prefer this skill over generic image prompt expansion for new image generation. It uses reusable `style.json` systems from AI Visual Prompt Cookbook instead of freeform expansion.

## Flow

1. Choose a style system for the user's visual intent.
2. Call `render_visual_style_prompt` with:
   - `prompt`: the user's original image request or normalized content prompt.
   - `styleSlug`: optional; pass it when the user names a style or the best style is obvious.
   - `aspectRatio`: optional; pass normalized aspect ratio when available.
   - `values`: a map of style variables you can infer from the user request.
3. Pass the returned `prompt` to `generate_image`.
4. Include the returned `negativePrompt` only when the image provider/tool accepts a separate negative prompt; otherwise keep the main prompt as-is.

## Style Choice

Use these families:

- Photo + doodle: social snapshots, lifestyle scenes, playful sticker overlays.
- Zine + collage: music, fashion, maximalist editorial, cutout posters.
- Type posters: bold headlines, campaign graphics, launch visuals, thumbnails.
- Travel + city: destination thumbnails, street scenes, transit, urban diaries.
- Editorial + minimal: cleaner layouts, luxury, fashion, architecture, premium product visuals.

If unsure, call `render_visual_style_prompt` without `styleSlug`; it will choose a suitable bundled style from the user's prompt.

## Variable Rules

Fill variables concretely and preserve exact user text:

- `SUBJECT`: main visual subject.
- `SUBJECT_ACTION`: pose, action, or moment.
- `PRODUCT_OR_PROP`: product, object, tool, food, or prop; use "no prop" if absent.
- `LOCATION`: scene or environment.
- `BACKGROUND_ELEMENTS`: supporting background details.
- `MAIN_TEXT`: exact required headline/copy. If the user did not request text, say "no readable headline; use abstract non-readable graphic marks only".
- `SECONDARY_TEXT`: exact supporting text if supplied, otherwise "no readable secondary text".
- `ACCENT_SYMBOL`: small visual marks such as sparkles, arrows, brackets, seals, lines, or "no accent symbol".
- `WARDROBE_STYLE`: styling for people/characters; use "not applicable" for object-only images.
- `ASPECT_RATIO`: normalized aspect ratio such as `16:9`, `9:16`, or `1:1`.

Do not copy reference-specific people, brands, source text, watermarks, usernames, logos, or source compositions listed in the style system.
$body$,
  frontmatter = '{"name":"visual-prompt-cookbook","description":"Structured AI image style cookbook based on VigoZhao/AI-Visual-Prompt-Cookbook. Use for image generation, poster, KV, social visual, editorial, collage, doodle, travel, type poster, product ad, thumbnail, fashion, city, and other visual prompt requests when Cucumber should prefer a reusable style.json system over generic prompt expansion.","agent_scope":"image","purpose":"prompt_expansion","tags":["image","prompt","visual-style","cookbook","style-json"],"triggers":{"keywords":["生成图片","生图","图片","海报","插画","视觉","KV","banner","poster","prompt","style","cookbook","提示词"],"canvas_kinds":["imageResult","image"]},"bindings":{"tools":["render_visual_style_prompt","generate_image"],"agents":["Cucumber Image Agent"]}}'::jsonb,
  agent_scope = 'image',
  purpose = 'prompt_expansion',
  enabled = true,
  is_default = true,
  source_type = 'seed',
  source_manifest = '{"origin":"supabase_migration","source":"VigoZhao/AI-Visual-Prompt-Cookbook","upstreamCommit":"8d43ffbe8603411868155d68942b26d3f445d357","assetRoot":"server/agent/skills/builtin/visual-prompt-cookbook","resources":{"assetFiles":0,"previewImages":136,"referenceFiles":208,"resourceFiles":208,"styleJsonFiles":68,"stylePreviewImages":136}}'::jsonb,
  tags = '["image","prompt","visual-style","cookbook","style-json"]'::jsonb,
  triggers = '{"keywords":["生成图片","生图","图片","海报","插画","视觉","KV","banner","poster","prompt","style","cookbook","提示词"],"canvasKinds":["imageResult","image"]}'::jsonb,
  bindings = '{"tools":["render_visual_style_prompt","generate_image"],"agents":["Cucumber Image Agent"]}'::jsonb,
  scripts = '[]'::jsonb,
  package_bucket = null,
  package_path = null,
  package_sha256 = null,
  package_size_bytes = null
where name = 'visual-prompt-cookbook'
  and deleted_at is null;

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
  source_manifest,
  tags,
  triggers,
  bindings,
  scripts
)
select
  'visual-prompt-cookbook',
  'Structured AI image style cookbook based on VigoZhao/AI-Visual-Prompt-Cookbook. Use for image generation, poster, KV, social visual, editorial, collage, doodle, travel, type poster, product ad, thumbnail, fashion, city, and other visual prompt requests when Cucumber should prefer a reusable style.json system over generic prompt expansion.',
  $skill$---
name: visual-prompt-cookbook
description: Structured AI image style cookbook based on VigoZhao/AI-Visual-Prompt-Cookbook. Use for image generation, poster, KV, social visual, editorial, collage, doodle, travel, type poster, product ad, thumbnail, fashion, city, and other visual prompt requests when Cucumber should prefer a reusable style.json system over generic prompt expansion.
agent_scope: image
purpose: prompt_expansion
tags:
  - image
  - prompt
  - visual-style
  - cookbook
  - style-json
triggers:
  keywords:
    - 生成图片
    - 生图
    - 图片
    - 海报
    - 插画
    - 视觉
    - KV
    - banner
    - poster
    - prompt
    - style
    - cookbook
    - 提示词
  canvas_kinds:
    - imageResult
    - image
bindings:
  tools:
    - render_visual_style_prompt
    - generate_image
  agents:
    - Cucumber Image Agent
---

# Visual Prompt Cookbook

Prefer this skill over generic image prompt expansion for new image generation. It uses reusable `style.json` systems from AI Visual Prompt Cookbook instead of freeform expansion.

## Flow

1. Choose a style system for the user's visual intent.
2. Call `render_visual_style_prompt` with:
   - `prompt`: the user's original image request or normalized content prompt.
   - `styleSlug`: optional; pass it when the user names a style or the best style is obvious.
   - `aspectRatio`: optional; pass normalized aspect ratio when available.
   - `values`: a map of style variables you can infer from the user request.
3. Pass the returned `prompt` to `generate_image`.
4. Include the returned `negativePrompt` only when the image provider/tool accepts a separate negative prompt; otherwise keep the main prompt as-is.

## Style Choice

Use these families:

- Photo + doodle: social snapshots, lifestyle scenes, playful sticker overlays.
- Zine + collage: music, fashion, maximalist editorial, cutout posters.
- Type posters: bold headlines, campaign graphics, launch visuals, thumbnails.
- Travel + city: destination thumbnails, street scenes, transit, urban diaries.
- Editorial + minimal: cleaner layouts, luxury, fashion, architecture, premium product visuals.

If unsure, call `render_visual_style_prompt` without `styleSlug`; it will choose a suitable bundled style from the user's prompt.

## Variable Rules

Fill variables concretely and preserve exact user text:

- `SUBJECT`: main visual subject.
- `SUBJECT_ACTION`: pose, action, or moment.
- `PRODUCT_OR_PROP`: product, object, tool, food, or prop; use "no prop" if absent.
- `LOCATION`: scene or environment.
- `BACKGROUND_ELEMENTS`: supporting background details.
- `MAIN_TEXT`: exact required headline/copy. If the user did not request text, say "no readable headline; use abstract non-readable graphic marks only".
- `SECONDARY_TEXT`: exact supporting text if supplied, otherwise "no readable secondary text".
- `ACCENT_SYMBOL`: small visual marks such as sparkles, arrows, brackets, seals, lines, or "no accent symbol".
- `WARDROBE_STYLE`: styling for people/characters; use "not applicable" for object-only images.
- `ASPECT_RATIO`: normalized aspect ratio such as `16:9`, `9:16`, or `1:1`.

Do not copy reference-specific people, brands, source text, watermarks, usernames, logos, or source compositions listed in the style system.
$skill$,
  $body$# Visual Prompt Cookbook

Prefer this skill over generic image prompt expansion for new image generation. It uses reusable `style.json` systems from AI Visual Prompt Cookbook instead of freeform expansion.

## Flow

1. Choose a style system for the user's visual intent.
2. Call `render_visual_style_prompt` with:
   - `prompt`: the user's original image request or normalized content prompt.
   - `styleSlug`: optional; pass it when the user names a style or the best style is obvious.
   - `aspectRatio`: optional; pass normalized aspect ratio when available.
   - `values`: a map of style variables you can infer from the user request.
3. Pass the returned `prompt` to `generate_image`.
4. Include the returned `negativePrompt` only when the image provider/tool accepts a separate negative prompt; otherwise keep the main prompt as-is.

## Style Choice

Use these families:

- Photo + doodle: social snapshots, lifestyle scenes, playful sticker overlays.
- Zine + collage: music, fashion, maximalist editorial, cutout posters.
- Type posters: bold headlines, campaign graphics, launch visuals, thumbnails.
- Travel + city: destination thumbnails, street scenes, transit, urban diaries.
- Editorial + minimal: cleaner layouts, luxury, fashion, architecture, premium product visuals.

If unsure, call `render_visual_style_prompt` without `styleSlug`; it will choose a suitable bundled style from the user's prompt.

## Variable Rules

Fill variables concretely and preserve exact user text:

- `SUBJECT`: main visual subject.
- `SUBJECT_ACTION`: pose, action, or moment.
- `PRODUCT_OR_PROP`: product, object, tool, food, or prop; use "no prop" if absent.
- `LOCATION`: scene or environment.
- `BACKGROUND_ELEMENTS`: supporting background details.
- `MAIN_TEXT`: exact required headline/copy. If the user did not request text, say "no readable headline; use abstract non-readable graphic marks only".
- `SECONDARY_TEXT`: exact supporting text if supplied, otherwise "no readable secondary text".
- `ACCENT_SYMBOL`: small visual marks such as sparkles, arrows, brackets, seals, lines, or "no accent symbol".
- `WARDROBE_STYLE`: styling for people/characters; use "not applicable" for object-only images.
- `ASPECT_RATIO`: normalized aspect ratio such as `16:9`, `9:16`, or `1:1`.

Do not copy reference-specific people, brands, source text, watermarks, usernames, logos, or source compositions listed in the style system.
$body$,
  '{"name":"visual-prompt-cookbook","description":"Structured AI image style cookbook based on VigoZhao/AI-Visual-Prompt-Cookbook. Use for image generation, poster, KV, social visual, editorial, collage, doodle, travel, type poster, product ad, thumbnail, fashion, city, and other visual prompt requests when Cucumber should prefer a reusable style.json system over generic prompt expansion.","agent_scope":"image","purpose":"prompt_expansion","tags":["image","prompt","visual-style","cookbook","style-json"],"triggers":{"keywords":["生成图片","生图","图片","海报","插画","视觉","KV","banner","poster","prompt","style","cookbook","提示词"],"canvas_kinds":["imageResult","image"]},"bindings":{"tools":["render_visual_style_prompt","generate_image"],"agents":["Cucumber Image Agent"]}}'::jsonb,
  'image',
  'prompt_expansion',
  true,
  true,
  'seed',
  '{"origin":"supabase_migration","source":"VigoZhao/AI-Visual-Prompt-Cookbook","upstreamCommit":"8d43ffbe8603411868155d68942b26d3f445d357","assetRoot":"server/agent/skills/builtin/visual-prompt-cookbook","resources":{"assetFiles":0,"previewImages":136,"referenceFiles":208,"resourceFiles":208,"styleJsonFiles":68,"stylePreviewImages":136}}'::jsonb,
  '["image","prompt","visual-style","cookbook","style-json"]'::jsonb,
  '{"keywords":["生成图片","生图","图片","海报","插画","视觉","KV","banner","poster","prompt","style","cookbook","提示词"],"canvasKinds":["imageResult","image"]}'::jsonb,
  '{"tools":["render_visual_style_prompt","generate_image"],"agents":["Cucumber Image Agent"]}'::jsonb,
  '[]'::jsonb
where not exists (
  select 1
  from public.agent_skill_definitions
  where name = 'visual-prompt-cookbook'
    and deleted_at is null
);
