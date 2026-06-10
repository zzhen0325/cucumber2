import { tool } from "@openai/agents";
import { z } from "zod";

import type { CanvasOperation } from "../../../../src/types/runtime.ts";
import { validateCanvasOperations } from "../../../runtime/canvas-operation-policy.ts";
import type { CucumberAgentContext } from "../../context.ts";

const attachArtifactInputSchema = z.object({
  nodeId: z.string().min(1),
  artifactId: z.string().min(1),
  operationId: z.string().min(1).optional(),
});

export const attachArtifactTool = tool({
  name: "attach_artifact",
  description:
    "Propose attaching an artifact created in this run to a canvas node. This validates and emits a proposal; it does not mutate storage directly.",
  parameters: attachArtifactInputSchema,
  async execute(args, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const artifact = context.producedArtifacts.find((item) => item.id === args.artifactId);
    if (!artifact) {
      return {
        accepted: [],
        rejected: [{ reason: "artifact_not_created_in_this_run", artifactId: args.artifactId }],
      };
    }

    const operation: CanvasOperation = {
      id: args.operationId ?? `attach-${args.artifactId}-${args.nodeId}`,
      projectId: context.projectId,
      type: "attachArtifact",
      payload: {
        artifact,
        artifactId: args.artifactId,
        nodeId: args.nodeId,
      },
    };
    const validation = validateCanvasOperations({
      artifactIds: context.producedArtifacts.map((item) => item.id),
      knownNodeIds: context.knownNodeIds,
      operations: [operation],
      projectId: context.projectId,
    });
    const acceptedOperations = validation.accepted.map((item) => item.operation);

    if (acceptedOperations.length) {
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
  },
});

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
