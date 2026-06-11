import { tool } from "@openai/agents";

import type { CanvasOperation } from "../../../../src/types/runtime.ts";
import { validateCanvasOperations } from "../../policy/canvas-operation-policy.ts";
import type { CucumberAgentContext } from "../../context.ts";
import {
  canvasOperationsInputSchema,
  canvasOperationsJsonSchema,
} from "./canvas-operation.schema.ts";

export const proposeCanvasOperationsTool = tool({
  name: "propose_canvas_operations",
  description:
    "Propose safe canvas operations. This never mutates the database directly; accepted operations are handed back to the Cucumber runtime.",
  parameters: canvasOperationsJsonSchema as never,
  strict: false,
  async execute(args, runContext) {
    const context = requireCucumberContext(runContext?.context);

    const parsed = canvasOperationsInputSchema.safeParse(args);
    if (!parsed.success) {
      const reason = `invalid_operations: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`;
      // Surface the validation error to the model so it can retry with a
      // well-formed payload. No canvas event is emitted for rejected input.
      return { accepted: [], rejected: [{ reason }] };
    }

    const operations = parsed.data.operations as CanvasOperation[];
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
  },
});

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}

function rememberOperationNodes(context: CucumberAgentContext, operation: CanvasOperation) {
  if (operation.type === "createNode") {
    context.knownNodeIds.push(operation.payload.node.id);
  }
  if (operation.type === "createEdge") {
    context.knownNodeIds.push(operation.payload.edge.source, operation.payload.edge.target);
  }
}
