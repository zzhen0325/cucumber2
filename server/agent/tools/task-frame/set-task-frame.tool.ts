import { tool } from "@openai/agents";

import type { AgentRunInput, CucumberAgentContext } from "../../context.ts";
import {
  finalizeNormalizedAgentInput,
  normalizedAgentInputSchema,
} from "../../task-frame.ts";
import { retrieveRelevantAgentSkills } from "../../skills/skill-retrieval.ts";

export const setTaskFrameTool = tool({
  name: "set_task_frame",
  description:
    "Set or revise the Super Agent's structured task_frame/workflow for this run when useful for planning, trace visibility, or skill retrieval. This updates runtime context, emits the visible input.normalized trace, and retrieves matching skill cards.",
  parameters: normalizedAgentInputSchema,
  strict: true,
  errorFunction: null,
  async execute(args, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const normalizedInput = finalizeNormalizedAgentInput(args, context.prompt);
    context.normalizedInput = normalizedInput;

    context.pendingEvents.push({
      type: "task_frame_set",
      normalizedInput,
    });

    const skillCandidates = await retrieveRelevantAgentSkills(
      buildSkillRetrievalInput(context)
    );
    context.skillCandidates = skillCandidates;
    context.pendingEvents.push({
      type: "skill_retrieved",
      candidates: skillCandidates,
    });

    return {
      candidateSkillCount: skillCandidates.length,
      constraints: normalizedInput.constraints.explicit,
      intent: normalizedInput.task.intent,
      requiredCapabilities: normalizedInput.workflow.requiredCapabilities,
      skillCards: skillCandidates.map((skill) => ({
        id: skill.id,
        name: skill.name,
        purpose: skill.purpose,
        reasons: skill.reasons,
        score: skill.score,
        tags: skill.tags,
      })),
      status: "task_frame_set",
      workflowMode: normalizedInput.workflow.mode,
    };
  },
});

function buildSkillRetrievalInput(
  context: CucumberAgentContext
): Pick<
  AgentRunInput,
  | "canvasSnapshot"
  | "forcedSkillId"
  | "message"
  | "normalizedInput"
  | "selectedNodeId"
  | "selectedNodeIds"
  | "upstreamContext"
> {
  return {
    canvasSnapshot: context.canvasSnapshot,
    forcedSkillId: context.forcedSkillId,
    message: context.prompt,
    normalizedInput: context.normalizedInput,
    selectedNodeId: context.selectedNodeId,
    selectedNodeIds: context.selectedNodeIds,
    upstreamContext: context.upstreamContext,
  };
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
