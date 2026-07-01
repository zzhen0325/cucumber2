import { Agent, Runner, tool } from "@openai/agents";
import { z } from "zod";

import type { CucumberAgentContext } from "../../context.ts";
import { getAgentRunnerConfig } from "../../model-config.ts";
import { assertImageToolAllowed } from "../../policy/task-artifact-policy.ts";
import type { ActivatedAgentSkill } from "../../skills/types.ts";

const expandImagePromptInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("The user's original compact or underspecified image-generation prompt."),
  reason: z
    .string()
    .describe("Brief internal reason this prompt needs expansion.")
    .optional(),
});

let promptExpansionRunner: Runner | undefined;

export const expandImagePromptTool = tool({
  name: "expand_image_prompt",
  description:
    "Use an activated image prompt-expansion skill to turn a short, keyword-like, or underspecified image request into one polished prompt. Call this before generate_image only when the user is asking to create a new image and the prompt lacks enough visual detail. Do not use for upscale-only requests.",
  parameters: expandImagePromptInputSchema,
  strict: true,
  errorFunction: null,
  isEnabled: async ({ runContext }) => {
    const context = requireCucumberContext(runContext.context);
    return Boolean(getActivatedPromptExpansionSkill(context));
  },
  async execute(args, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    assertImageToolAllowed(context, "expand_image_prompt");

    const skill = getActivatedPromptExpansionSkill(context);
    if (!skill) {
      return {
        error:
          "prompt_expansion_skill_missing: call activate_skill for an image prompt-expansion candidate before expand_image_prompt.",
      };
    }

    const agent = new Agent<CucumberAgentContext>({
      name: "Cucumber Image Prompt Expander",
      instructions: buildPromptExpansionInstructions(skill.body),
      tools: [],
    });
    const result = await getPromptExpansionRunner().run(
      agent,
      buildPromptExpansionInput({
        prompt: args.prompt,
        reason: args.reason,
      }),
      {
        context,
        maxTurns: 2,
        signal: details?.signal,
      }
    );
    const expandedPrompt = normalizeExpandedPrompt(result.finalOutput);
    if (!expandedPrompt) {
      throw new Error("Prompt expansion skill returned an empty prompt.");
    }

    return {
      expandedPrompt,
      skillId: skill.id,
      skillName: skill.name,
    };
  },
});

function getPromptExpansionRunner() {
  promptExpansionRunner ??= new Runner({
    workflowName: "Cucumber Image Prompt Skill",
    ...getAgentRunnerConfig(),
  });
  return promptExpansionRunner;
}

function buildPromptExpansionInstructions(skillBody: string) {
  return [
    "You are running one activated image prompt skill for Cucumber Super Agent.",
    "Follow the skill instructions exactly. Return only the final expanded image prompt, with no analysis, labels, JSON, markdown fence, or alternatives.",
    "<skill_content name=\"image_prompt_expansion\">",
    skillBody,
    "</skill_content>",
  ].join("\n\n");
}

function buildPromptExpansionInput({
  prompt,
  reason,
}: {
  prompt: string;
  reason?: string;
}) {
  return [
    `Original user image prompt: ${prompt}`,
    reason ? `Why expansion is needed: ${reason}` : null,
    "Expand it into exactly one final prompt.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeExpandedPrompt(output: unknown) {
  if (typeof output === "string") {
    return stripMarkdownFence(output.trim());
  }
  if (output === undefined || output === null) {
    return "";
  }
  return stripMarkdownFence(JSON.stringify(output).trim());
}

function stripMarkdownFence(text: string) {
  return text
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function getActivatedPromptExpansionSkill(
  context: CucumberAgentContext
): ActivatedAgentSkill | undefined {
  return context.activatedSkills.find(
    (skill) =>
      skill.agentScope === "image" &&
      (skill.purpose === "prompt_expansion" ||
        skill.bindings.tools.includes("expand_image_prompt"))
  );
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
