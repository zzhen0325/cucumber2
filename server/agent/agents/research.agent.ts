import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { researchInstructions } from "../prompts/research.instructions.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { collectResearchSourcesTool } from "../tools/research/collect-research-sources.tool.ts";
import { createResearchArtifactTool } from "../tools/research/create-research-artifact.tool.ts";

let researchAgent: Agent<CucumberAgentContext> | undefined;

export function createResearchAgent() {
  researchAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Research Agent",
    handoffDescription:
      "Research specialist. Delegate here for source-based research, comparison, synthesis, and answers that cite explicit public URLs or trusted canvas sources. Does not perform general web search yet.",
    instructions: (runContext) => researchInstructions(runContext.context),
    tools: [searchKnowledgeTool, collectResearchSourcesTool, createResearchArtifactTool],
  });
  return researchAgent;
}
