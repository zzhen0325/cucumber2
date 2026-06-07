import { describe, expect, it } from "vitest";

import { canEditSkill } from "./skill-access";

describe("skill access guard", () => {
  it("allows only the uploader to edit an active skill", () => {
    expect(
      canEditSkill("user-1", { ownerUserId: "user-1", deletedAt: null })
    ).toBe(true);
  });

  it("blocks public readers, missing skills, and deleted skills", () => {
    expect(canEditSkill("user-1", null)).toBe(false);
    expect(
      canEditSkill("user-1", { ownerUserId: "user-2", deletedAt: null })
    ).toBe(false);
    expect(
      canEditSkill("user-1", {
        ownerUserId: "user-1",
        deletedAt: "2026-06-07T00:00:00.000Z",
      })
    ).toBe(false);
  });
});
