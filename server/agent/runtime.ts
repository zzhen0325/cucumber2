import { Runner } from "@openai/agents";
import { UnixLocalSandboxClient } from "@openai/agents/sandbox/local";

import type { AgentEvent } from "../../src/types/runtime.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import { createManagerAgent } from "./agents/manager.agent.ts";
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
import { getAgentErrorMessage, isAbortError } from "./errors.ts";
import { normalizeAgentInput } from "./input-normalizer.ts";
import {
  ensureCucumberInternalMcpConnected,
} from "./mcp/internal-mcp-client.ts";
import {
  registerMcpRunContext,
  unregisterMcpRunContext,
} from "./mcp/context-registry.ts";
import {
  materializeAgentRunSnapshot,
  shouldMaterializeRunEvent,
} from "./materialize-run.ts";
import { getAgentModelConfiguration, resolveAgentModel } from "./model-config.ts";
import { retrieveRelevantAgentSkills } from "./skills/skill-retrieval.ts";
import { prepareSdkSkillSource } from "./skills/sdk-skill-source.ts";

const runner = new Runner({ workflowName: "Cucumber Agent" });

export class OpenAIAgentsRuntime implements AgentRuntime {
  async *run(input: AgentRunInput): AsyncIterable<CucumberRunEvent> {
    const model = resolveAgentModel();
    const normalizedInput =
      input.normalizedInput ??
      (await normalizeAgentInput(input, { model, signal: input.signal }));
    const normalizedRunInput = { ...input, normalizedInput };
    const context = buildCucumberAgentContext(normalizedRunInput);
    const mcpContextId = registerMcpRunContext(context);
    let sdkSkillSource: Awaited<ReturnType<typeof prepareSdkSkillSource>> = null;
    try {
      context.skillCandidates = await retrieveRelevantAgentSkills(normalizedRunInput);
      yield { type: "skill_retrieved", candidates: context.skillCandidates };
      sdkSkillSource = await prepareSdkSkillSource(context.skillCandidates);

      await ensureCucumberInternalMcpConnected();
      const managerAgent = createManagerAgent({
        model,
        sandboxCapabilities: {
          includeCompaction: getAgentModelConfiguration().provider === "openai",
        },
        skillCapability: sdkSkillSource?.capability,
      });

      const stream = await runner.run(managerAgent, buildManagerRunPrompt(normalizedRunInput), {
        context,
        maxTurns: 8,
        ...(sdkSkillSource
          ? { sandbox: { client: new UnixLocalSandboxClient() } }
          : {}),
        signal: input.signal,
        stream: true,
      });
      yield* openAIStreamToCucumberEvents(stream, context);
    } finally {
      await sdkSkillSource?.cleanup().catch(() => undefined);
      unregisterMcpRunContext(mcpContextId);
    }
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
  let agentInput = buildAgentRunInput(input);
  const textStreamId = `agent-text-${crypto.randomUUID()}`;
  let textStarted = false;
  let finalOutput: string | undefined;
  let artifactIds: string[] = [];
  const runEvents: AgentEvent[] = [];

  const trackEvent = async (event: AgentEvent) => {
    runEvents.push(event);
    if (shouldMaterializeRunEvent(event.type)) {
      await flushAndMaterializeRun();
    }
    return event;
  };

  const writeRunEvent = async (
    event: Omit<AgentEvent, "createdAt"> & { createdAt?: string }
  ) => trackEvent(await eventWriter.writeEvent(event));

  const flushAndMaterializeRun = async () => {
    await eventWriter.flush();
    await materializeAgentRunSnapshot({
      events: runEvents,
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      userId: input.userId,
    });
  };

  try {
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.created",
      payload: {
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        selectedNodeIds: agentInput.selectedNodeIds,
        upstreamContext: agentInput.upstreamContext,
        runtime: "openai-agents-sdk",
      },
    });
    const model = resolveAgentModel();
    agentInput = {
      ...agentInput,
      normalizedInput: await normalizeAgentInput(agentInput, {
        model,
        signal: input.signal,
      }),
    };
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: {
        normalizedInput: agentInput.normalizedInput,
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        selectedNodeIds: agentInput.selectedNodeIds,
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
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "agent",
          type: "agent.active",
          payload: { agentName: event.agentName, runtime: "openai-agents-sdk" },
        });
        continue;
      }

      if (event.type === "skill_retrieved") {
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "skill-retrieval",
          type: "skill.retrieved",
          payload: {
            candidates: event.candidates.map((skill) => ({
              agentScope: skill.agentScope,
              bindings: skill.bindings,
              description: skill.description,
              id: skill.id,
              isDefault: skill.isDefault,
              name: skill.name,
              purpose: skill.purpose,
              reasons: skill.reasons,
              score: skill.score,
              scripts: skill.scripts,
              tags: skill.tags,
              triggers: skill.triggers,
            })),
            runtime: "openai-agents-sdk",
          },
        });
        continue;
      }

      if (event.type === "handoff_requested" || event.type === "handoff_completed") {
        await writeRunEvent({
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
        await trackEvent(
          await eventWriter.writeToolInput({
            stepId: event.toolName,
            toolCallId: event.toolCallId ?? `${event.toolName}-${crypto.randomUUID()}`,
            toolName: event.toolName,
            toolInput: event.input ?? {},
            metadata: { runtime: "openai-agents-sdk" },
          })
        );
        continue;
      }

      if (event.type === "tool_completed") {
        await trackEvent(
          await eventWriter.writeToolOutput({
            stepId: event.toolName,
            toolCallId: event.toolCallId ?? `${event.toolName}-${crypto.randomUUID()}`,
            toolName: event.toolName,
            output: event.output ?? {},
            metadata: { runtime: "openai-agents-sdk" },
          })
        );
        continue;
      }

      if (event.type === "tool_failed") {
        await trackEvent(
          await eventWriter.writeToolError({
            stepId: event.toolName,
            toolCallId: event.toolCallId ?? `${event.toolName}-${crypto.randomUUID()}`,
            toolName: event.toolName,
            input: event.input,
            inputWritten: true,
            errorText: event.message,
            errorCode: "tool_failed",
            metadata: { runtime: "openai-agents-sdk" },
          })
        );
        continue;
      }

      if (event.type === "canvas_operation_proposed" || event.type === "canvas_operation_applied") {
        const writtenEvents = await writeCanvasOperationEvents({
          operations: event.operations,
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          type:
            event.type === "canvas_operation_proposed"
              ? "canvas.operation.proposed"
              : "canvas.operation.applied",
          writer: eventWriter,
        });
        for (const writtenEvent of writtenEvents) {
          await trackEvent(writtenEvent);
        }
        continue;
      }

      if (event.type === "canvas_operation_rejected") {
        for (const rejected of event.rejections) {
          await writeRunEvent({
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
        const toolName = event.toolName ?? "generate_image";
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: toolName,
          type: "artifact.created",
          payload: {
            artifact: event.artifact,
            canvasNodeId: event.canvasNodeId,
            runtime: "openai-agents-sdk",
            toolName,
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
    await eventWriter.flush();
    await writeRunEvent({
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
    const message = aborted ? "Run stopped by user." : getAgentErrorMessage(error);
    if (!aborted) {
      console.error("[agent-run]", error);
    }
    closeTextStream();
    const failedEvent = await eventWriter.writeEvent({
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
    runEvents.push(failedEvent);
    await eventWriter.flush().catch((flushError: unknown) => {
      if (!aborted) {
        console.error("[agent-run:persist]", flushError);
      }
    });
    await materializeAgentRunSnapshot({
      events: runEvents,
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      userId: input.userId,
    }).catch((materializeError: unknown) => {
      if (!aborted) {
        console.error("[agent-run:materialize]", materializeError);
      }
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
  const writtenEvents: AgentEvent[] = [];
  for (const operation of operations) {
    writtenEvents.push(
      await writer.writeEvent({
        projectId,
        runNodeId,
        stepId: "propose_canvas_operations",
        type,
        payload: { operation, runtime: "openai-agents-sdk" },
      })
    );
  }
  return writtenEvents;
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
    input.normalizedInput
      ? `Normalized input: ${JSON.stringify(input.normalizedInput)}`
      : "",
    `Project id: ${input.projectId}`,
    `Run node id: ${input.runNodeId}`,
    `Selected node ids: ${input.selectedNodeIds.join(", ") || "none"}`,
    `Canvas snapshot summary: ${input.canvasSnapshot.nodes.length} nodes, ${input.canvasSnapshot.edges.length} edges.`,
    `Trusted upstream context: ${JSON.stringify([
      ...input.upstreamContext.filter((item) => item.type !== "image"),
      ...imageContext,
    ].slice(0, 12))}`,
  ].filter(Boolean).join("\n\n");
}
