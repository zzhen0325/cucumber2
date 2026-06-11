import { Agent, Runner } from "@openai/agents";

import type { CanvasOperation } from "../../src/types/runtime.ts";
import { managerAgent } from "./agents/manager.agent.ts";
import {
  buildAgentRunInput,
  buildCucumberAgentContext,
  type AgentRunInput,
  type AgentRuntime,
  type CucumberRunEvent,
  type ExecuteAgentRunInput,
} from "./context.ts";
import {
  createAgentEventWriter,
  type AgentEventWriter,
} from "./events/runtime-event-writer.ts";
import { openAIStreamToCucumberEvents } from "./events/openai-stream-to-cucumber-events.ts";
import { resolveAgentModel } from "./model-config.ts";

const runner = new Runner({ workflowName: "Cucumber Agent" });

export class OpenAIAgentsRuntime implements AgentRuntime {
  async *run(input: AgentRunInput): AsyncIterable<CucumberRunEvent> {
    const context = buildCucumberAgentContext(input);
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
      signal: input.signal,
      stream: true,
    });
    yield* openAIStreamToCucumberEvents(stream, context);
  }
}

export const agentRuntime = new OpenAIAgentsRuntime();

export async function executeAgentRun({
  writer: streamWriter,
  ...input
}: ExecuteAgentRunInput) {
  const eventWriter = createAgentEventWriter({
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    writer: streamWriter,
  });
  const agentInput = buildAgentRunInput(input);
  const textStreamId = `agent-text-${crypto.randomUUID()}`;
  let textStarted = false;
  let finalOutput: string | undefined;
  let artifactIds: string[] = [];

  try {
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.created",
      payload: {
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        upstreamContext: agentInput.upstreamContext,
        runtime: "openai-agents-sdk",
      },
    });
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: {
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        upstreamContext: agentInput.upstreamContext,
        runtime: "openai-agents-sdk",
      },
    });

    for await (const event of agentRuntime.run(agentInput)) {
      if (event.type === "text_delta") {
        if (!textStarted) {
          textStarted = true;
          streamWriter.write({ type: "start-step" });
          streamWriter.write({ type: "text-start", id: textStreamId });
        }
        streamWriter.write({ type: "text-delta", id: textStreamId, delta: event.text });
        continue;
      }

      if (event.type === "agent_active") {
        await eventWriter.writeEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "agent",
          type: "agent.active",
          payload: { agentName: event.agentName, runtime: "openai-agents-sdk" },
        });
        continue;
      }

      if (event.type === "handoff_requested" || event.type === "handoff_completed") {
        await eventWriter.writeEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "handoff",
          type: event.type === "handoff_requested" ? "handoff.requested" : "handoff.completed",
          payload: {
            fromAgent: event.fromAgent,
            toAgent: event.toAgent,
            runtime: "openai-agents-sdk",
          },
        });
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

      if (event.type === "tool_failed") {
        await eventWriter.writeToolError({
          stepId: event.toolName,
          toolCallId: event.toolCallId ?? `${event.toolName}-${crypto.randomUUID()}`,
          toolName: event.toolName,
          input: event.input,
          inputWritten: true,
          errorText: event.message,
          errorCode: "tool_failed",
          metadata: { runtime: "openai-agents-sdk" },
        });
        continue;
      }

      if (event.type === "canvas_operation_proposed" || event.type === "canvas_operation_applied") {
        await writeCanvasOperationEvents({
          operations: event.operations,
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          type:
            event.type === "canvas_operation_proposed"
              ? "canvas.operation.proposed"
              : "canvas.operation.applied",
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
          stepId: "generate_image",
          type: "artifact.created",
          payload: {
            artifact: event.artifact,
            canvasNodeId: event.canvasNodeId,
            runtime: "openai-agents-sdk",
            toolName: "generate_image",
          },
        });
        continue;
      }

      if (event.type === "run_completed") {
        finalOutput = event.finalOutput;
        artifactIds = event.artifactIds;
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    closeTextStream();
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.completed",
      payload: {
        artifactIds,
        finalOutput,
        runtime: "openai-agents-sdk",
        status: "completed",
      },
    });
  } catch (error) {
    const aborted = input.signal?.aborted || isAbortError(error);
    const message = aborted ? "Run stopped by user." : getErrorMessage(error);
    if (!aborted) {
      console.error("[agent-run]", error);
    }
    closeTextStream();
    await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.failed",
      payload: {
        errorCode: aborted ? "agent_run_aborted" : "agent_run_failed",
        errorText: message,
        runtime: "openai-agents-sdk",
        status: "failed",
      },
      errorText: message,
    });
  }

  function closeTextStream() {
    if (!textStarted) {
      return;
    }
    streamWriter.write({ type: "text-end", id: textStreamId });
    streamWriter.write({ type: "finish-step" });
    textStarted = false;
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
  writer: AgentEventWriter;
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
  const imageContext = input.upstreamContext
    .filter((item) => item.type === "image")
    .map(({ nodeId, type, prompt, summary, title, priority }) => ({
      nodeId,
      type,
      prompt,
      summary,
      title,
      priority,
    }));
  return [
    `User request: ${input.message}`,
    `Project id: ${input.projectId}`,
    `Run node id: ${input.runNodeId}`,
    `Selected node ids: ${input.selectedNodeIds.join(", ") || "none"}`,
    `Canvas snapshot summary: ${input.canvasSnapshot.nodes.length} nodes, ${input.canvasSnapshot.edges.length} edges.`,
    `Trusted upstream context: ${JSON.stringify([
      ...input.upstreamContext.filter((item) => item.type !== "image"),
      ...imageContext,
    ].slice(0, 12))}`,
  ].join("\n\n");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
