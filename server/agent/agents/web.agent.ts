import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { webInstructions } from "../prompts/web.instructions.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { fetchWebpageTool } from "../tools/web/fetch-webpage.tool.ts";

let webAgent: Agent<CucumberAgentContext> | undefined;

export function createWebAgent() {
  webAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Web Agent",
    handoffDescription:
      "Web specialist. Delegate here for fetching, reading, saving, or briefly summarizing one public http(s) webpage as a canvas artifact. Does not automate a browser or access logged-in pages.",
    instructions: (runContext) => webInstructions(runContext.context),
    tools: [searchKnowledgeTool, fetchWebpageTool],
  });
  return webAgent;
}
