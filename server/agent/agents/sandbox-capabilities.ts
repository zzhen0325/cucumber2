import {
  compaction,
  filesystem,
  shell,
  type Capability,
} from "@openai/agents/sandbox";
import type { Tool } from "@openai/agents";

export type CucumberSandboxCapabilityOptions = {
  includeCompaction?: boolean;
};

export function createCucumberSandboxCapabilities(
  skillCapability: Capability,
  options: CucumberSandboxCapabilityOptions = {}
) {
  const capabilities = [
    filesystem({ configureTools: withoutApplyPatchTool }),
    shell(),
    skillCapability,
  ];

  if (options.includeCompaction ?? true) {
    capabilities.splice(2, 0, compaction());
  }

  return capabilities;
}

export function withoutApplyPatchTool(tools: Tool[]) {
  return tools.filter((tool) => !isApplyPatchTool(tool));
}

function isApplyPatchTool(tool: Tool) {
  return tool.type === "apply_patch" || ("name" in tool && tool.name === "apply_patch");
}
