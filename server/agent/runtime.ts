import { Runner } from "@openai/agents";

import type { AgentEvent } from "../../src/types/runtime.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import { createDocumentAgent } from "./agents/document.agent.ts";
import { createImageAgent } from "./agents/image.agent.ts";
import { createManagerAgent } from "./agents/manager.agent.ts";
import { createResearchAgent } from "./agents/research.agent.ts";
import { createWebAgent } from "./agents/web.agent.ts";
import {
  AgentContextValidationError,
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
import {
  normalizeAgentInput,
  selectAgentRoute,
} from "./input-normalizer.ts";
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
import { getAgentRunnerConfig } from "./model-config.ts";
import { retrieveRelevantAgentSkills } from "./skills/skill-retrieval.ts";
import { storeTextArtifactContent } from "../storage.ts";
import { buildRunPlan } from "./run-plan.ts";
import { redactTraceValue } from "./trace-redaction.ts";
import { getToolTraceMetadata } from "./tool-registry.ts";

let runner: Runner | undefined;

export class OpenAIAgentsRuntime implements AgentRuntime {
  async *run(input: AgentRunInput): AsyncIterable<CucumberRunEvent> {
    const normalizedInput =
      input.normalizedInput ??
      (await normalizeAgentInput(input, { signal: input.signal }));
    const normalizedRunInput = { ...input, normalizedInput };
    const context = buildCucumberAgentContext(normalizedRunInput);
    const mcpContextId = registerMcpRunContext(context);
    try {
      context.skillCandidates = await retrieveRelevantAgentSkills(normalizedRunInput);
      yield { type: "skill_retrieved", candidates: context.skillCandidates };

      await ensureCucumberInternalMcpConnected();
      const startAgent = createStartingAgentForRun(normalizedInput);

      const stream = await getAgentRunner().run(startAgent, buildManagerRunPrompt(normalizedRunInput), {
        context,
        maxTurns: 8,
        signal: input.signal,
        stream: true,
      });
      yield* openAIStreamToCucumberEvents(stream, context);
    } finally {
      unregisterMcpRunContext(mcpContextId);
    }
  }
}

export const agentRuntime = new OpenAIAgentsRuntime();

function getAgentRunner() {
  runner ??= new Runner({
    workflowName: "Cucumber Agent",
    ...getAgentRunnerConfig(),
  });
  return runner;
}

function createStartingAgentForRun(
  normalizedInput: NonNullable<AgentRunInput["normalizedInput"]>
) {
  switch (selectAgentRoute(normalizedInput)) {
    case "document":
      return createDocumentAgent();
    case "image":
      return createImageAgent();
    case "research":
      return createResearchAgent();
    case "web":
      return createWebAgent();
    case "manager":
    default:
      return createManagerAgent();
  }
}

export async function executeAgentRun({
  writer: streamWriter,
  ...input
}: ExecuteAgentRunInput) {
  const eventWriter = createAgentEventWriter({
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    writer: streamWriter,
  });
  let agentInput: AgentRunInput | null = null;
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
    agentInput = buildAgentRunInput(input);
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.created",
      payload: buildRedactedPayload({
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        selectedNodeIds: agentInput.selectedNodeIds,
        contextSummary: agentInput.contextSummary,
        upstreamContext: agentInput.upstreamContext,
        runtime: "openai-agents-sdk",
      }),
    });
    agentInput = {
      ...agentInput,
      normalizedInput: await normalizeAgentInput(agentInput, {
        signal: input.signal,
      }),
    };
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: buildRedactedPayload({
        normalizedInput: agentInput.normalizedInput,
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        selectedNodeIds: agentInput.selectedNodeIds,
        contextSummary: agentInput.contextSummary,
        upstreamContext: agentInput.upstreamContext,
        runtime: "openai-agents-sdk",
      }),
    });
    const runPlan = buildRunPlan(agentInput);
    if (runPlan.length > 0) {
      await writeRunEvent({
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        stepId: "plan",
        type: "run.plan.created",
        payload: {
          items: runPlan,
          retryFrom: agentInput.retryFrom ?? null,
          runtime: "openai-agents-sdk",
        },
      });
    }

    for await (const event of agentRuntime.run(agentInput)) {
      if (event.type === "text_delta") {
        if (!textStarted) {
          textStarted = true;
          writeStreamPart({ type: "start-step" });
          writeStreamPart({ type: "text-start", id: textStreamId });
        }
        writeStreamPart({ type: "text-delta", id: textStreamId, delta: event.text });
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
              capabilities: skill.capabilities,
              description: skill.description,
              id: skill.id,
              name: skill.name,
              notFor: skill.notFor,
              produces: skill.produces,
              purpose: skill.purpose,
              reasons: skill.reasons,
              score: skill.score,
              scripts: skill.scripts,
              tags: skill.tags,
              triggers: skill.triggers,
              uses: skill.uses,
            })),
            runtime: "openai-agents-sdk",
          },
        });
        continue;
      }

      if (event.type === "skill_activated") {
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "activate_skill",
          type: "skill.activated",
          payload: {
            runtime: "openai-agents-sdk",
            skill: event.skill,
          },
        });
        continue;
      }

      if (
        event.type === "skill_script_started" ||
        event.type === "skill_script_completed" ||
        event.type === "skill_script_failed"
      ) {
        const inputRedaction =
          "input" in event ? redactTraceValue(event.input) : undefined;
        const outputRedaction =
          "output" in event ? redactTraceValue(event.output) : undefined;
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: `skill-script:${event.scriptName}`,
          type:
            event.type === "skill_script_started"
              ? "skill.script.started"
              : event.type === "skill_script_completed"
                ? "skill.script.completed"
                : "skill.script.failed",
          payload: {
            input: inputRedaction?.value,
            output: outputRedaction?.value,
            metadata: getToolTraceMetadata("run_skill_script"),
            redaction: {
              input: inputRedaction?.summary,
              output: outputRedaction?.summary,
            },
            runtime: "openai-agents-sdk",
            scriptName: event.scriptName,
            skillId: event.skillId,
            skillName: event.skillName,
          },
          errorText: "message" in event ? event.message : undefined,
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
    if (finalOutput?.trim() && artifactIds.length === 0) {
      const artifact = await storeTextArtifactContent({
        content: finalOutput,
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        sourceToolName: "final_output",
        title: "Agent reply",
        userId: input.userId,
      });
      artifactIds = [artifact.id];
      await writeRunEvent({
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        stepId: "final_output",
        type: "artifact.created",
        payload: {
          artifact,
          runtime: "openai-agents-sdk",
          toolName: "final_output",
        },
      });
    }
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
    const failure = classifyRunFailure({
      aborted,
      error,
      events: runEvents,
      message,
    });
    if (!aborted) {
      console.error("[agent-run]", error);
    }
    closeTextStream();
    const failedEvent = await eventWriter.writeEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.failed",
      payload: buildRedactedPayload({
        errorCode: failure.errorCode,
        errorSource: failure.errorSource,
        errorText: message,
        prompt: agentInput?.message ?? input.canvasContext.prompt,
        promptNodeId: agentInput?.promptNodeId ?? input.canvasContext.promptNodeId ?? null,
        selectedNodeId: agentInput?.selectedNodeId ?? input.canvasContext.selectedNodeId ?? null,
        selectedNodeIds: agentInput?.selectedNodeIds ?? input.canvasContext.selectedNodeIds ?? [],
        contextSummary: agentInput?.contextSummary,
        runtime: "openai-agents-sdk",
        status: "failed",
      }),
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
    writeStreamPart({ type: "text-end", id: textStreamId });
    writeStreamPart({ type: "finish-step" });
    textStarted = false;
  }

  function writeStreamPart(part: Parameters<typeof streamWriter.write>[0]) {
    try {
      streamWriter.write(part);
    } catch {
      // The run can continue after the user leaves; persisted events hydrate UI.
    }
  }
}

function classifyRunFailure({
  aborted,
  error,
  events,
  message,
}: {
  aborted: boolean;
  error: unknown;
  events: AgentEvent[];
  message: string;
}) {
  if (aborted) {
    return {
      errorCode: "agent_run_aborted",
      errorSource: "user",
    };
  }

  if (error instanceof AgentContextValidationError) {
    return {
      errorCode: "context_validation_failed",
      errorSource: "context",
    };
  }

  if (isAgentEventPersistenceError(error, message)) {
    return {
      errorCode: "agent_trace_persistence_failed",
      errorSource: "trace_storage",
    };
  }

  const skillScriptFailed = events.findLast(
    (event) => event.type === "skill.script.failed"
  );
  if (skillScriptFailed) {
    return {
      errorCode: "skill_script_failed",
      errorSource: "skill_script",
    };
  }

  const toolError = events.findLast((event) => event.type === "tool.error");
  const toolName = typeof toolError?.payload.toolName === "string"
    ? toolError.payload.toolName
    : "";
  if (/coze/i.test(message)) {
    return {
      errorCode: "coze_failed",
      errorSource: "coze",
    };
  }

  if (/seedream/i.test(message) || /generate_image|upscale_image/.test(toolName)) {
    return {
      errorCode: "seedream_failed",
      errorSource: "seedream",
    };
  }

  if (toolError) {
    return {
      errorCode: "tool_failed",
      errorSource: "tool",
    };
  }

  return {
    errorCode: "agent_run_failed",
    errorSource: "model",
  };
}

function isAgentEventPersistenceError(error: unknown, message: string) {
  const combined = [
    message,
    readErrorString(error, "code"),
    readErrorString(error, "details"),
    readErrorString(error, "hint"),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    combined.includes("agent_run_events") ||
    combined.includes("agent_run_events_type_check")
  );
}

function readErrorString(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function buildRedactedPayload(payload: Record<string, unknown>) {
  const redacted = redactTraceValue(payload);
  return {
    ...(redacted.value as Record<string, unknown>),
    redaction: redacted.summary,
  };
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
    input.retryFrom
      ? [
          "Retry context:",
          JSON.stringify({
            failedRunNodeId: input.retryFrom.failedRunNodeId,
            stepId: input.retryFrom.stepId,
            label: input.retryFrom.label,
            toolName: input.retryFrom.toolName,
            errorText: input.retryFrom.errorText,
          }),
          "Resume from the failed step when possible. Preserve already completed upstream work and do not repeat completed tool work unless it is required to recover.",
        ].join("\n")
      : "",
  ].filter(Boolean).join("\n\n");
}
