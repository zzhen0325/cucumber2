begin;

alter function public.apply_canvas_patch(
  uuid,
  uuid,
  bigint,
  jsonb,
  text[],
  jsonb,
  text[],
  text,
  text
) security invoker;

alter function public.upsert_text_artifact_content(
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb
) security invoker;

commit;
