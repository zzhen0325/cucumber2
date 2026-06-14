import { tool } from "@openai/agents";
import { z } from "zod";

import { getAgentSkillDefinition } from "../../../supabase.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { MAX_ACTIVATED_SKILLS_PER_RUN, type ActivatedAgentSkill } from "../../skills/types.ts";

const activateSkillInputSchema = z
  .object({
    reason: z.string().max(1000).optional(),
    skillId: z.string().min(1).optional(),
    skillName: z.string().min(1).optional(),
  })
  .refine((value) => value.skillId || value.skillName, {
    message: "skillId or skillName is required.",
  });

const activateSkillJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: {
      type: "string",
      description: "Brief reason this skill is needed for the current run.",
    },
    skillId: {
      type: "string",
      description: "Skill id from the retrieved skill cards.",
    },
    skillName: {
      type: "string",
      description: "Skill name from the retrieved skill cards.",
    },
  },
} as const;

export const activateSkillTool = tool({
  name: "activate_skill",
  description:
    "Load the full SKILL.md instructions for one retrieved skill before applying that skill. Only call this for skill ids or names shown in the current run's skill cards.",
  parameters: activateSkillJsonSchema as never,
  strict: false,
  errorFunction: null,
  isEnabled: async ({ runContext }) => {
    const context = requireCucumberContext(runContext.context);
    return (
      context.skillCandidates.length > 0 &&
      context.activatedSkills.length < MAX_ACTIVATED_SKILLS_PER_RUN
    );
  },
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = activateSkillInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_activate_skill_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const candidate = context.skillCandidates.find(
      (skill) =>
        skill.id === parsed.data.skillId ||
        (parsed.data.skillName && skill.name === parsed.data.skillName)
    );
    if (!candidate) {
      return {
        error: "skill_not_retrieved: activate_skill can only load a retrieved candidate.",
      };
    }

    const existing = context.activatedSkills.find((skill) => skill.id === candidate.id);
    if (existing) {
      return toToolResult(existing, "already_active");
    }

    if (context.activatedSkills.length >= MAX_ACTIVATED_SKILLS_PER_RUN) {
      return {
        error: `activation_limit_reached: max ${MAX_ACTIVATED_SKILLS_PER_RUN} skills per run.`,
      };
    }

    const fullSkill = await getAgentSkillDefinition(candidate.id);
    if (!fullSkill || !fullSkill.enabled) {
      return {
        error: "skill_unavailable: the retrieved skill is no longer enabled.",
      };
    }

    const activated: ActivatedAgentSkill = {
      ...candidate,
      body: fullSkill.body,
      frontmatter: fullSkill.frontmatter,
      packageBucket: fullSkill.packageBucket,
      packagePath: fullSkill.packagePath,
      packageSha256: fullSkill.packageSha256,
      packageSizeBytes: fullSkill.packageSizeBytes,
      scripts: fullSkill.scripts,
      skillMd: fullSkill.skillMd,
      tags: fullSkill.tags,
    };
    context.activatedSkills.push(activated);
    context.pendingEvents.push({
      type: "skill_activated",
      skill: {
        agentScope: activated.agentScope,
        id: activated.id,
        name: activated.name,
        purpose: activated.purpose,
        scripts: activated.scripts,
        tags: activated.tags,
      },
    });

    return toToolResult(activated, "activated");
  },
});

function toToolResult(skill: ActivatedAgentSkill, status: "activated" | "already_active") {
  return {
    agentScope: skill.agentScope,
    instructions: skill.body,
    purpose: skill.purpose,
    scriptCount: skill.scripts.length,
    scripts: skill.scripts.map(({ description, input, name, output, runtime }) => ({
      description,
      input,
      name,
      output,
      runtime,
    })),
    skillId: skill.id,
    skillName: skill.name,
    status,
    tags: skill.tags,
  };
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
