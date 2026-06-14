import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { researchInstructions } from "../prompts/research.instructions.ts";
import { collectResearchSourcesTool } from "../tools/research/collect-research-sources.tool.ts";
import { createResearchArtifactTool } from "../tools/research/create-research-artifact.tool.ts";

// The runtime injects the resolved model so specialists stay on one provider
// path.
export function createResearchAgent({
  model,
}: {
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  return new Agent<CucumberAgentContext>({
    name: "Cucumber Research Agent",
    handoffDescription:
      "Research specialist. Delegate here for source-based research, comparison, synthesis, and answers that cite explicit public URLs or trusted canvas sources. Does not perform general web search yet.",
    instructions: (runContext) => researchInstructions(runContext.context),
    ...(model ? { model } : {}),
    tools: [collectResearchSourcesTool, createResearchArtifactTool],
  });
}
