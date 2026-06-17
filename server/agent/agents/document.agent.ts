import { Agent } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { documentInstructions } from "../prompts/document.instructions.ts";
import { createTextArtifactTool } from "../tools/artifact/create-text-artifact.tool.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { readSkillResourceTool } from "../tools/skills/read-skill-resource.tool.ts";

let documentAgent: Agent<CucumberAgentContext> | undefined;

export function createDocumentAgent() {
  documentAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Document Agent",
    handoffDescription:
      "Text artifact specialist. Delegate here for markdown/document/diagram/html webpage/code creation, rewriting, structured drafts, PRDs, briefs, notes, demos, and summaries that should become canvas artifacts.",
    instructions: (runContext) => documentInstructions(runContext.context),
    tools: [
      activateSkillTool,
      readSkillResourceTool,
      searchKnowledgeTool,
      createTextArtifactTool,
    ],
  });
  return documentAgent;
}
