import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { agentEventTypes } from "../../src/types/runtime";

describe("runtime event schema", () => {
  it("keeps the latest Supabase agent_run_events type constraint in sync", () => {
    const migrationsDir = join(process.cwd(), "supabase", "migrations");
    const latestConstraintMigration = readdirSync(migrationsDir)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort()
      .reverse()
      .find((fileName) =>
        readFileSync(join(migrationsDir, fileName), "utf8").includes(
          "agent_run_events_type_check"
        )
      );

    expect(latestConstraintMigration).toBeTruthy();

    const sql = readFileSync(
      join(migrationsDir, latestConstraintMigration as string),
      "utf8"
    );

    for (const eventType of agentEventTypes) {
      expect(sql).toContain(`'${eventType}'::text`);
    }
  });
});
