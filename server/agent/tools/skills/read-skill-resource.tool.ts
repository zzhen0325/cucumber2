import { tool } from "@openai/agents";
import { z } from "zod";

import type { CucumberAgentContext } from "../../context.ts";
import {
  listActivatedSkillResources,
  readActivatedSkillResource,
} from "../../skills/skill-resources.ts";

const readSkillResourceInputSchema = z
  .object({
    operation: z.enum(["list", "read"]).default("list"),
    resourcePath: z.string().trim().min(1).optional(),
    skillId: z.string().min(1).optional(),
    skillName: z.string().min(1).optional(),
  })
  .refine((value) => value.skillId || value.skillName, {
    message: "skillId or skillName is required.",
  })
  .refine((value) => value.operation === "list" || value.resourcePath, {
    message: "resourcePath is required for read.",
  });

const readSkillResourceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: {
      type: "string",
      enum: ["list", "read"],
      description: "Use list to inspect available resources, or read for one text resource.",
    },
    resourcePath: {
      type: "string",
      description:
        "Resource path returned by list, such as references/catalog.md or references/styles/foo/style.json.",
    },
    skillId: {
      type: "string",
      description: "Activated skill id.",
    },
    skillName: {
      type: "string",
      description: "Activated skill name.",
    },
  },
  required: ["operation"],
} as const;

export const readSkillResourceTool = tool({
  name: "read_skill_resource",
  description:
    "List or read bundled resources from an activated Agent Skills package. Use after activate_skill when SKILL.md references package files such as references/, assets/, scripts/, agents/openai.yaml, LICENSE, or other resources. Text resources are returned inline; binary assets are listed but not embedded.",
  parameters: readSkillResourceJsonSchema as never,
  strict: false,
  errorFunction: null,
  isEnabled: async ({ runContext }) => {
    const context = requireCucumberContext(runContext.context);
    return context.activatedSkills.length > 0;
  },
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = readSkillResourceInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_read_skill_resource_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const skill = context.activatedSkills.find(
      (candidate) =>
        candidate.id === parsed.data.skillId ||
        (parsed.data.skillName && candidate.name === parsed.data.skillName)
    );
    if (!skill) {
      return {
        error: "skill_not_activated: read_skill_resource requires activate_skill first.",
      };
    }

    if (parsed.data.operation === "read") {
      return {
        resource: await readActivatedSkillResource({
          resourcePath: parsed.data.resourcePath ?? "",
          skill,
        }),
        skillId: skill.id,
        skillName: skill.name,
      };
    }

    return {
      resources: await listActivatedSkillResources(skill),
      skillId: skill.id,
      skillName: skill.name,
    };
  },
});

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
