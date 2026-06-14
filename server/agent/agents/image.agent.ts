import { Agent, type RunContext } from "@openai/agents";
import { Capabilities, SandboxAgent, type Capability } from "@openai/agents/sandbox";

import type { CucumberAgentContext } from "../context.ts";
import { getCucumberInternalMcpServer } from "../mcp/internal-mcp-client.ts";
import { upscaleImageTool } from "../tools/image/upscale-image.tool.ts";
import { imageInstructions } from "../prompts/image.instructions.ts";

// NOTE: like the manager agent, the model is intentionally NOT set here. It is
// resolved lazily at run time (see runtime.ts) because the model provider
// depends on environment variables loaded *after* this module is imported.
export function createImageAgent({
  skillCapability,
  model,
}: {
  skillCapability?: Capability;
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  const commonConfig = {
    name: "Cucumber Image Agent",
    handoffDescription:
      "Image specialist. Delegate here for any request that needs images generated, created, edited, or upscaled (with or without reference images on the canvas).",
    instructions: (runContext: RunContext<CucumberAgentContext>) =>
      imageInstructions(runContext.context),
    ...(model ? { model } : {}),
    mcpConfig: {
      convertSchemasToStrict: false,
      errorFunction: null,
      includeServerInToolNames: false,
    },
    mcpServers: [getCucumberInternalMcpServer()],
    tools: [
      upscaleImageTool,
    ],
  };

  if (skillCapability) {
    return new SandboxAgent<CucumberAgentContext>({
      ...commonConfig,
      capabilities: [...Capabilities.default(), skillCapability],
    });
  }

  return new Agent<CucumberAgentContext>({
    ...commonConfig,
  });
}
