import { describe, expect, it } from "vitest";

import { canAccessProject } from "./project-access";

describe("project access guard", () => {
  it("allows the owner to access an active project", () => {
    expect(
      canAccessProject("user-1", { userId: "user-1", deletedAt: null })
    ).toBe(true);
  });

  it("blocks missing, cross-user, and soft-deleted projects", () => {
    expect(canAccessProject("user-1", null)).toBe(false);
    expect(
      canAccessProject("user-1", { userId: "user-2", deletedAt: null })
    ).toBe(false);
    expect(
      canAccessProject("user-1", {
        userId: "user-1",
        deletedAt: "2026-06-07T00:00:00.000Z",
      })
    ).toBe(false);
  });
});
