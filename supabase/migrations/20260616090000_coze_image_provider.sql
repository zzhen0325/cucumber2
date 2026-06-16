alter table public.agent_artifacts
  drop constraint if exists agent_artifacts_origin_check,
  add constraint agent_artifacts_origin_check
    check (
      origin = any (
        array[
          'user_upload'::text,
          'seedream_generated'::text,
          'coze_generated'::text
        ]
      )
    );
