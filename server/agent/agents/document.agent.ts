import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { documentInstructions } from "../prompts/document.instructions.ts";
import { createTextArtifactTool } from "../tools/artifact/create-text-artifact.tool.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";

// The model is injected by runtime so all specialists use the same provider
// resolution path.
export function createDocumentAgent({
  model,
}: {
  model?: Agent<CucumberAgentContext>["model"];
} = {}) {
  return new Agent<CucumberAgentContext>({
    name: "Cucumber Document Agent",
    handoffDescription:
      "Document specialist. Delegate here for markdown/document creation, rewriting, structured drafts, PRDs, briefs, notes, and summaries that should become canvas artifacts.",
    instructions: (runContext) => documentInstructions(runContext.context),
    ...(model ? { model } : {}),
    tools: [searchKnowledgeTool, createTextArtifactTool],
  });
}
