import { describe, expect, it } from "vitest";

import { getAgentErrorMessage } from "./errors";

describe("agent error messages", () => {
  it("formats Supabase/PostgREST object errors without losing the message", () => {
    expect(
      getAgentErrorMessage({
        code: "PGRST205",
        details: null,
        hint: "Perhaps you meant the table 'public.agent_run_events'",
        message:
          "Could not find the table 'public.agent_skill_definitions' in the schema cache",
      })
    ).toBe(
      "Could not find the table 'public.agent_skill_definitions' in the schema cache Code: PGRST205 Hint: Perhaps you meant the table 'public.agent_run_events'"
    );
  });

  it("falls back to JSON for unknown plain objects", () => {
    expect(getAgentErrorMessage({ failed: true })).toBe('{"failed":true}');
  });
});
