import { Agent, Runner, tool } from "@openai/agents";
import { z } from "zod";

import type { CucumberAgentContext } from "../../context.ts";
import { getAgentRunnerConfig } from "../../model-config.ts";
import { assertImageToolAllowed } from "../../policy/task-artifact-policy.ts";
import type { ActivatedAgentSkill } from "../../skills/types.ts";

const expandImagePromptInputSchema = z.object({
  prompt: z.string().min(1),
  reason: z.string().optional(),
});

const expandImagePromptJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: {
      type: "string",
      description:
        "The user's original compact or underspecified image-generation prompt.",
    },
    reason: {
      type: "string",
      description:
        "Brief internal reason this prompt needs expansion, such as missing composition, style, color, or layout details.",
    },
  },
  required: ["prompt"],
} as const;

let promptExpansionRunner: Runner | undefined;

export const expandImagePromptTool = tool({
  name: "expand_image_prompt",
  description:
    "Use an activated image prompt-expansion skill to turn a short, keyword-like, or underspecified image request into one polished prompt. Call this before generate_image only when the user is asking to create a new image and the prompt lacks enough visual detail. Do not use for upscale-only requests.",
  parameters: expandImagePromptJsonSchema as never,
  strict: false,
  errorFunction: null,
  isEnabled: async ({ runContext }) => {
    const context = requireCucumberContext(runContext.context);
    return Boolean(getActivatedPromptExpansionSkill(context));
  },
  async execute(rawArgs, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    assertImageToolAllowed(context, "expand_image_prompt");
    const parsed = expandImagePromptInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_prompt_expansion_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

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
        prompt: parsed.data.prompt,
        reason: parsed.data.reason,
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
    "You are running one activated Agent Skill for Cucumber Image Agent.",
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
