import { describe, expect, it } from "vitest";

import {
  PROMPT_EXPAND_CAPABILITY_ID,
  assertCapabilityMayExecute,
  buildCapabilityRegistry,
  parseCapabilityManifest,
  toTypedCapabilityError,
} from "./capabilities";

describe("capability registry", () => {
  it("registers old prompt-expand skills through the compatibility manifest", () => {
    const registry = buildCapabilityRegistry([
      {
        id: "skill-1",
        name: "prompt-expand",
        slug: "prompt-expand",
        description: "扩写 prompt",
        instructions: "只输出扩写 prompt。",
        config: {},
        sourceManifest: {},
      },
    ]);

    expect(
      registry.find(
        (capability) =>
          capability.manifest.capabilityId === PROMPT_EXPAND_CAPABILITY_ID
      )
    ).toMatchObject({
      source: "skill-compat",
      skill: { id: "skill-1" },
    });
  });

  it("marks approval-required capabilities as non-executable without approval", () => {
    const manifest = parseCapabilityManifest({
      capabilityId: "files.write",
      version: "1.0.0",
      description: "Write a file",
      triggers: ["write"],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      toolIds: ["write_file"],
      requiresApproval: true,
      policy: {
        canWriteFiles: true,
        requiresApproval: true,
      },
    });

    expect(() =>
      assertCapabilityMayExecute({
        manifest,
        source: "skill-manifest",
      })
    ).toThrow("需要用户确认");
  });

  it("maps missing provider keys to typed environment errors", () => {
    const error = toTypedCapabilityError(
      new Error("SEEDREAM_ACCESS_KEY_ID is not configured.")
    );

    expect(error.code).toBe("env.missing");
    expect(error.message).toContain("SEEDREAM_ACCESS_KEY_ID");
  });
});
