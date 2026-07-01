import { tool } from "@openai/agents";
import { z } from "zod";

import type { CanvasOperation } from "../../../../src/types/runtime.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { validateCanvasOperations } from "../../policy/canvas-operation-policy.ts";
import { runSkillScript } from "../../skills/skill-script-runner.ts";

const runSkillScriptInputSchema = z.object({
  args: z.array(z.string().max(500)).max(50).optional(),
  input: z.unknown().optional(),
  scriptName: z.string().min(1),
  skillId: z.string().min(1),
  stdin: z.string().max(100_000).optional(),
});

const runSkillScriptJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    args: {
      type: "array",
      items: { type: "string" },
      maxItems: 50,
      description:
        "Optional command-line arguments for standard Agent Skills scripts, for example ['--help'].",
    },
    input: {
      type: "object",
      additionalProperties: true,
      description:
        "JSON input for the script. Must match the activated skill's script expectations.",
    },
    scriptName: {
      type: "string",
      description: "Name of the script exposed by the activated skill.",
    },
    skillId: {
      type: "string",
      description: "Activated skill id that owns the script.",
    },
    stdin: {
      type: "string",
      description:
        "Optional raw stdin. If omitted, the tool sends JSON.stringify(input ?? {}) to stdin.",
    },
  },
  required: ["skillId", "scriptName"],
} as const;

export const runSkillScriptTool = tool({
  name: "run_skill_script",
  description:
    "Run a script exposed by an activated skill in a sandbox. Supports discovered Agent Skills scripts with optional args/stdin. JSON skill output is parsed; ordinary stdout is wrapped as data. Scripts cannot write the database or canvas directly; returned canvasOperations still go through runtime policy.",
  parameters: runSkillScriptJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = runSkillScriptInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_run_skill_script_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const skill = context.activatedSkills.find(
      (candidate) => candidate.id === parsed.data.skillId
    );
    if (!skill) {
      return {
        error: "skill_not_activated: run_skill_script requires activate_skill first.",
      };
    }
    const script = skill.scripts.find(
      (candidate) => candidate.name === parsed.data.scriptName
    );
    if (!script) {
      return {
        error: "script_not_found: activated skill does not expose this script.",
      };
    }

    context.pendingEvents.push({
      type: "skill_script_started",
      input: parsed.data.input,
      scriptName: script.name,
      skillId: skill.id,
      skillName: skill.name,
    });

    try {
      const output = await runSkillScript({
        args: parsed.data.args,
        input: parsed.data.input,
        scriptName: script.name,
        signal: details?.signal,
        skill,
        stdin: parsed.data.stdin,
      });
      const canvasResult = applyReturnedCanvasOperations(
        context,
        output.canvasOperations ?? []
      );
      const toolOutput = {
        ...output,
        canvasOperations: undefined,
        canvasOperationResult: canvasResult,
      };
      context.pendingEvents.push({
        type: "skill_script_completed",
        output: toolOutput,
        scriptName: script.name,
        skillId: skill.id,
        skillName: skill.name,
      });
      return toolOutput;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.pendingEvents.push({
        type: "skill_script_failed",
        input: parsed.data.input,
        message,
        scriptName: script.name,
        skillId: skill.id,
        skillName: skill.name,
      });
      throw error;
    }
  },
});

function applyReturnedCanvasOperations(
  context: CucumberAgentContext,
  operations: CanvasOperation[]
) {
  if (!operations.length) {
    return { accepted: [], rejected: [] };
  }

  const validation = validateCanvasOperations({
    knownNodeIds: context.knownNodeIds,
    operations,
    projectId: context.projectId,
    runNodeId: context.runNodeId,
  });
  const acceptedOperations = validation.accepted.map((item) => item.operation);

  if (acceptedOperations.length) {
    for (const operation of acceptedOperations) {
      rememberOperationNodes(context, operation);
    }
    context.pendingEvents.push(
      { type: "canvas_operation_proposed", operations: acceptedOperations },
      { type: "canvas_operation_applied", operations: acceptedOperations }
    );
  }

  if (validation.rejected.length) {
    context.pendingEvents.push({
      type: "canvas_operation_rejected",
      rejections: validation.rejected,
    });
  }

  return {
    accepted: acceptedOperations,
    rejected: validation.rejected,
  };
}

function rememberOperationNodes(context: CucumberAgentContext, operation: CanvasOperation) {
  if (operation.type === "createNode") {
    context.knownNodeIds.push(operation.payload.node.id);
  }
  if (operation.type === "createEdge") {
    context.knownNodeIds.push(operation.payload.edge.source, operation.payload.edge.target);
  }
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
