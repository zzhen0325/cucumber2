import { Agent, Runner } from "@openai/agents";

import type { RuntimeEventWriter } from "../runtime/events.ts";
import { createRuntimeEventWriter } from "../runtime/events.ts";
import { recordRunEvent } from "../supabase.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import { managerAgent } from "./agents/manager.agent.ts";
import { resolveAgentModel } from "./model-config.ts";
import type {
  AgentRunInput,
  AgentRuntime,
  CucumberRunEvent,
  ExecuteAgentRunV2Input,
} from "./context.ts";
import { buildAgentRunInputV2, buildCucumberAgentContext } from "./context.ts";
import { openAIStreamToCucumberEvents } from "./events/openai-stream-to-cucumber-events.ts";

const runner = new Runner({ workflowName: "Cucumber Agent V2" });

export class OpenAIAgentsRuntime implements AgentRuntime {
  async *run(input: AgentRunInput): AsyncIterable<CucumberRunEvent> {
    const context = buildCucumberAgentContext(input);
    // Resolve the model lazily, now that env vars are loaded. The same model is
    // applied to every agent in the graph (manager + handoff specialists) so a
    // handoff does not silently fall back to a different provider.
    const model = resolveAgentModel();
    if (model) {
      managerAgent.model = model;
      for (const handoff of managerAgent.handoffs) {
        if (handoff instanceof Agent) {
          handoff.model = model;
        }
      }
    }
    const stream = await runner.run(managerAgent, buildManagerRunPrompt(input), {
      context,
      maxTurns: 8,
      stream: true,
    });

    yield* openAIStreamToCucumberEvents(stream, context);
  }
}

export const openAIAgentsRuntime = new OpenAIAgentsRuntime();

export async function executeOpenAIAgentsRunV2({
  writer: streamWriter,
  ...input
}: ExecuteAgentRunV2Input) {
  const eventWriter = createRuntimeEventWriter({
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    writer: streamWriter,
  });
  const agentInput = buildAgentRunInputV2(input);
  const textStreamId = `agent-v2-text-${crypto.randomUUID()}`;
  let textStarted = false;
  let finalOutput: string | undefined;

  try {
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.created",
      payload: {
        prompt: input.canvasContext.prompt,
        promptNodeId: input.canvasContext.promptNodeId ?? null,
        selectedNodeId: input.canvasContext.selectedNodeId ?? null,
        upstreamContext: input.canvasContext.upstreamContext,
        contextTrace: input.canvasContext.contextTrace,
        runtime: "openai-agents-sdk",
        routing: "agent-v2 manager agent + proposal-first tools",
      },
    });
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: { input: agentInput, runtime: "openai-agents-sdk" },
    });

    for await (const event of openAIAgentsRuntime.run(agentInput)) {
      if (event.type === "text_delta") {
        if (!textStarted) {
          textStarted = true;
          streamWriter.write({ type: "start-step" });
          streamWriter.write({ type: "text-start", id: textStreamId });
        }
        streamWriter.write({ type: "text-delta", id: textStreamId, delta: event.text });
        continue;
      }

      if (event.type === "tool_started") {
        await eventWriter.writeToolInput({
          stepId: event.toolName,
          toolCallId: event.toolCallId ?? `${event.toolName}-${crypto.randomUUID()}`,
          toolName: event.toolName,
          toolInput: event.input ?? {},
          metadata: { runtime: "openai-agents-sdk" },
        });
        continue;
      }

      if (event.type === "tool_completed") {
        await eventWriter.writeToolOutput({
          stepId: event.toolName,
          toolCallId: event.toolCallId ?? `${event.toolName}-${crypto.randomUUID()}`,
          toolName: event.toolName,
          output: event.output ?? {},
          metadata: { runtime: "openai-agents-sdk" },
        });
        continue;
      }

      if (event.type === "canvas_operation_proposed") {
        await writeCanvasOperationEvents({
          operations: event.operations,
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          type: "canvas.operation.proposed",
          writer: eventWriter,
        });
        continue;
      }

      if (event.type === "canvas_operation_applied") {
        await writeCanvasOperationEvents({
          operations: event.operations,
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          type: "canvas.operation.applied",
          writer: eventWriter,
        });
        continue;
      }

      if (event.type === "canvas_operation_rejected") {
        for (const rejected of event.rejections) {
          await eventWriter.writeEvent({
            projectId: input.projectId,
            runNodeId: input.runNodeId,
            stepId: "canvas-policy",
            type: "canvas.operation.rejected",
            payload: {
              operation: rejected.operation,
              reason: rejected.reason,
              runtime: "openai-agents-sdk",
            },
            errorText: `Canvas operation ${rejected.operation.id} was rejected: ${rejected.reason}.`,
          });
        }
        continue;
      }

      if (event.type === "artifact_created") {
        await eventWriter.writeEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "create_artifact",
          type: "artifact.created",
          payload: {
            artifact: event.artifact,
            canvasNodeId: event.canvasNodeId,
            runtime: "openai-agents-sdk",
            toolName: "create_artifact",
          },
        });
        continue;
      }

      if (event.type === "run_completed") {
        finalOutput = event.finalOutput;
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    if (textStarted) {
      streamWriter.write({ type: "text-end", id: textStreamId });
      streamWriter.write({ type: "finish-step" });
    }

    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.completed",
      payload: {
        artifactIds: [],
        finalOutput,
        runtime: "openai-agents-sdk",
        status: "completed",
      },
    });
    await recordRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      prompt: input.canvasContext.prompt,
      selectedNodeId: input.canvasContext.selectedNodeId ?? null,
      upstreamContext: input.canvasContext.upstreamContext,
      status: "success",
      skillInput: agentInput,
      skillOutput: { finalOutput, runtime: "openai-agents-sdk" },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[agent-run-v2]", error);
    if (textStarted) {
      streamWriter.write({ type: "text-end", id: textStreamId });
      streamWriter.write({ type: "finish-step" });
    }
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.failed",
      payload: {
        errorCode: "agent_v2_failed",
        errorText: message,
        runtime: "openai-agents-sdk",
        status: "failed",
      },
      errorText: message,
    });
    await recordRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      prompt: input.canvasContext.prompt,
      selectedNodeId: input.canvasContext.selectedNodeId ?? null,
      upstreamContext: input.canvasContext.upstreamContext,
      status: "error",
      skillInput: agentInput,
      errorText: message,
    });
  }
}

async function writeCanvasOperationEvents({
  operations,
  projectId,
  runNodeId,
  type,
  writer,
}: {
  operations: CanvasOperation[];
  projectId: string;
  runNodeId: string;
  type: "canvas.operation.proposed" | "canvas.operation.applied";
  writer: RuntimeEventWriter;
}) {
  for (const operation of operations) {
    await writer.writeEvent({
      projectId,
      runNodeId,
      stepId: "propose_canvas_operations",
      type,
      payload: { operation, runtime: "openai-agents-sdk" },
    });
  }
}

function buildManagerRunPrompt(input: AgentRunInput) {
  return [
    `User request: ${input.message}`,
    `Project id: ${input.projectId}`,
    `Run node id: ${input.runNodeId}`,
    `Selected node ids: ${input.selectedNodeIds?.join(", ") || "none"}`,
    `Canvas snapshot summary: ${input.canvasSnapshot.nodes.length} nodes, ${input.canvasSnapshot.edges.length} edges.`,
    `Known upstream context: ${JSON.stringify(input.canvasContext.upstreamContext.slice(0, 12))}`,
  ].join("\n\n");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
