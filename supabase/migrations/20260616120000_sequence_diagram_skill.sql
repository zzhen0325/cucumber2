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
  bindings
)
select
  'sequence-diagram',
  'Create Mermaid sequence diagrams as Markdown artifacts for flows, product requirements, H5 visual design processes, and interaction timelines.',
  $skill$---
name: sequence-diagram
description: Create Mermaid sequence diagrams as Markdown artifacts for flows, product requirements, H5 visual design processes, and interaction timelines.
agent_scope: document
purpose: diagram
tags:
  - diagram
  - mermaid
  - markdown
  - sequence-diagram
capabilities:
  - artifact.kind: diagram
    artifact.subtype: sequenceDiagram
    artifact.format: mermaid
    requiredCapabilities:
      - sequence-diagram
      - markdown-artifact
produces:
  - markdown
uses:
  - create_text_artifact
notFor:
  - image-generation
triggers:
  keywords:
    - 时序图
    - 流程时序图
    - sequence diagram
    - Mermaid
  canvas_kinds:
    - markdown
    - document
bindings:
  tools:
    - create_text_artifact
  agents:
    - Cucumber Document Agent
---

# Sequence Diagram

Use this skill when the user asks for a sequence diagram, process sequence, interaction timeline, or flow timing diagram that should become a canvas text artifact.

## Output Contract

- Create exactly one Markdown artifact with `create_text_artifact`.
- The artifact content must include a Mermaid fenced code block using `sequenceDiagram`.
- Use `format: "markdown"` in `create_text_artifact`.
- Do not call image-generation, image-prompt, upscale, webpage, research, or canvas-operation tools.
- If the user mentions visual design, H5, campaign, marketing, product, or engineering context, treat that as domain context for participants and messages, not as a raster image request.

## Mermaid Rules

- Start the diagram block with:

```mermaid
sequenceDiagram
```

- Use clear participant names in the user's language.
- Prefer concrete request, review, handoff, feedback, and delivery messages.
- Add short notes only when they clarify a decision point.
- Keep the diagram concise enough to read on the canvas.

## Recommended Artifact Shape

Use this Markdown structure:

```markdown
# <short title>

```mermaid
sequenceDiagram
  participant A as ...
  participant B as ...
  A->>B: ...
```

## 说明

- ...
```
$skill$,
  $body$# Sequence Diagram

Use this skill when the user asks for a sequence diagram, process sequence, interaction timeline, or flow timing diagram that should become a canvas text artifact.

## Output Contract

- Create exactly one Markdown artifact with `create_text_artifact`.
- The artifact content must include a Mermaid fenced code block using `sequenceDiagram`.
- Use `format: "markdown"` in `create_text_artifact`.
- Do not call image-generation, image-prompt, upscale, webpage, research, or canvas-operation tools.
- If the user mentions visual design, H5, campaign, marketing, product, or engineering context, treat that as domain context for participants and messages, not as a raster image request.

## Mermaid Rules

- Start the diagram block with:

```mermaid
sequenceDiagram
```

- Use clear participant names in the user's language.
- Prefer concrete request, review, handoff, feedback, and delivery messages.
- Add short notes only when they clarify a decision point.
- Keep the diagram concise enough to read on the canvas.

## Recommended Artifact Shape

Use this Markdown structure:

```markdown
# <short title>

```mermaid
sequenceDiagram
  participant A as ...
  participant B as ...
  A->>B: ...
```

## 说明

- ...
```
$body$,
  '{"name":"sequence-diagram","description":"Create Mermaid sequence diagrams as Markdown artifacts for flows, product requirements, H5 visual design processes, and interaction timelines.","agent_scope":"document","purpose":"diagram","tags":["diagram","mermaid","markdown","sequence-diagram"],"capabilities":[{"artifact.kind":"diagram","artifact.subtype":"sequenceDiagram","artifact.format":"mermaid","requiredCapabilities":["sequence-diagram","markdown-artifact"]}],"produces":["markdown"],"uses":["create_text_artifact"],"notFor":["image-generation"],"triggers":{"keywords":["时序图","流程时序图","sequence diagram","Mermaid"],"canvas_kinds":["markdown","document"]},"bindings":{"tools":["create_text_artifact"],"agents":["Cucumber Document Agent"]}}'::jsonb,
  'document',
  'diagram',
  true,
  false,
  'seed',
  '{"origin":"supabase_migration","fileName":"sequence-diagram/SKILL.md"}'::jsonb,
  '["diagram","mermaid","markdown","sequence-diagram"]'::jsonb,
  '{"keywords":["时序图","流程时序图","sequence diagram","Mermaid"],"canvasKinds":["markdown","document"]}'::jsonb,
  '{"tools":["create_text_artifact"],"agents":["Cucumber Document Agent"],"scopes":["tool.doc.create","write.artifact"]}'::jsonb
where not exists (
  select 1
  from public.agent_skill_definitions
  where name = 'sequence-diagram'
    and deleted_at is null
);
