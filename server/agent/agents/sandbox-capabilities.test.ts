import { describe, expect, it } from "vitest";
import type { Capability } from "@openai/agents/sandbox";

import {
  createCucumberSandboxCapabilities,
  withoutApplyPatchTool,
} from "./sandbox-capabilities.ts";

describe("sandbox capabilities", () => {
  const skillCapability = { type: "skills" } as Capability;

  it("includes SDK compaction by default for native OpenAI runs", () => {
    expect(createCucumberSandboxCapabilities(skillCapability).map((capability) => capability.type))
      .toEqual(["filesystem", "shell", "compaction", "skills"]);
  });

  it("can omit SDK compaction for OpenAI-compatible providers that reject context_management", () => {
    expect(
      createCucumberSandboxCapabilities(skillCapability, { includeCompaction: false }).map(
        (capability) => capability.type
      )
    ).toEqual(["filesystem", "shell", "skills"]);
  });

  it("removes native and fallback apply_patch tools", () => {
    const tools = withoutApplyPatchTool([
      { type: "apply_patch", name: "apply_patch" },
      { type: "function", name: "apply_patch" },
      { type: "function", name: "load_skill" },
      { type: "function", name: "exec_command" },
    ] as never);

    expect(tools).toEqual([
      { type: "function", name: "load_skill" },
      { type: "function", name: "exec_command" },
    ]);
  });
});
