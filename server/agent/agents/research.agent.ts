import { Agent, webSearchTool } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { supportsHostedWebSearchTool } from "../model-config.ts";
import { researchInstructions } from "../prompts/research.instructions.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { collectResearchSourcesTool } from "../tools/research/collect-research-sources.tool.ts";
import { createResearchArtifactTool } from "../tools/research/create-research-artifact.tool.ts";

let researchAgent: Agent<CucumberAgentContext> | undefined;

export function createResearchAgent() {
  const hostedWebSearchEnabled = supportsHostedWebSearchTool();
  researchAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Research Agent",
    handoffDescription:
      "Research specialist. Delegate here for web-backed research, comparison, synthesis, and answers that cite public URLs or trusted canvas sources.",
    instructions: (runContext) =>
      researchInstructions(runContext.context, { hostedWebSearchEnabled }),
    tools: [
      ...(hostedWebSearchEnabled
        ? [webSearchTool({ searchContextSize: "medium" })]
        : []),
      searchKnowledgeTool,
      collectResearchSourcesTool,
      createResearchArtifactTool,
    ],
  });
  return researchAgent;
}
