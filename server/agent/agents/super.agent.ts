import { Agent, webSearchTool } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import {
  supportsHostedWebSearchTool,
  type AgentModelProviderName,
} from "../model-config.ts";
import { superInstructions } from "../prompts/super.instructions.ts";
import { createTextArtifactTool } from "../tools/artifact/create-text-artifact.tool.ts";
import { proposeCanvasOperationsTool } from "../tools/canvas/propose-canvas-operations.tool.ts";
import { decomposeImageTool } from "../tools/image/image-inspection.tool.ts";
import { expandImagePromptTool } from "../tools/image/expand-image-prompt.tool.ts";
import { generateImageTool } from "../tools/image/generate-image.tool.ts";
import { imageMattingTool } from "../tools/image/image-matting.tool.ts";
import { renderVisualStylePromptTool } from "../tools/image/render-visual-style-prompt.tool.ts";
import { upscaleImageTool } from "../tools/image/upscale-image.tool.ts";
import { searchKnowledgeTool } from "../tools/knowledge/search-knowledge.tool.ts";
import { collectResearchSourcesTool } from "../tools/research/collect-research-sources.tool.ts";
import { createResearchArtifactTool } from "../tools/research/create-research-artifact.tool.ts";
import { activateSkillTool } from "../tools/skills/activate-skill.tool.ts";
import { readSkillResourceTool } from "../tools/skills/read-skill-resource.tool.ts";
import { runSkillScriptTool } from "../tools/skills/run-skill-script.tool.ts";
import { setTaskFrameTool } from "../tools/task-frame/set-task-frame.tool.ts";
import { fetchWebpageTool } from "../tools/web/fetch-webpage.tool.ts";

const superAgents = new Map<string, Agent<CucumberAgentContext>>();

export function createSuperAgent(agentProvider?: AgentModelProviderName) {
  const cacheKey = agentProvider ?? "auto";
  const cachedAgent = superAgents.get(cacheKey);
  if (cachedAgent) {
    return cachedAgent;
  }

  const hostedWebSearchEnabled = supportsHostedWebSearchTool(agentProvider);

  const superAgent = new Agent<CucumberAgentContext>({
    name: "Cucumber Super Agent",
    instructions: (runContext) => superInstructions(runContext.context),
    tools: [
      setTaskFrameTool,
      activateSkillTool,
      readSkillResourceTool,
      runSkillScriptTool,
      searchKnowledgeTool,
      proposeCanvasOperationsTool,
      createTextArtifactTool,
      fetchWebpageTool,
      ...(hostedWebSearchEnabled
        ? [webSearchTool({ searchContextSize: "medium" })]
        : []),
      collectResearchSourcesTool,
      createResearchArtifactTool,
      decomposeImageTool,
      expandImagePromptTool,
      generateImageTool,
      imageMattingTool,
      renderVisualStylePromptTool,
      upscaleImageTool,
    ],
  });

  superAgents.set(cacheKey, superAgent);
  return superAgent;
}
