import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  verifyPassword,
} from "./auth";

describe("server auth helpers", () => {
  it("normalizes usernames for simple name-password auth", () => {
    expect(normalizeUsername("  Alice  ")).toBe("alice");
  });

  it("hashes and verifies passwords without storing plaintext", async () => {
    const passwordHash = await hashPassword("cucumber-secret");

    expect(passwordHash).not.toContain("cucumber-secret");
    await expect(verifyPassword("cucumber-secret", passwordHash)).resolves.toBe(
      true
    );
    await expect(verifyPassword("wrong-secret", passwordHash)).resolves.toBe(
      false
    );
  });

  it("hashes session tokens deterministically without keeping the raw token", () => {
    const session = createSessionToken();

    expect(session.token).not.toBe(session.tokenHash);
    expect(hashSessionToken(session.token)).toBe(session.tokenHash);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
