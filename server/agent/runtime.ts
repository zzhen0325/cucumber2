import { Agent, Runner, type AgentInputItem } from "@openai/agents";

import type { AgentEvent } from "../../src/types/runtime.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import type { UpstreamContextItem } from "../../src/types/canvas.ts";
import { createDocumentAgent } from "./agents/document.agent.ts";
import { createImageAgent } from "./agents/image.agent.ts";
import { createManagerAgent } from "./agents/manager.agent.ts";
import { createResearchAgent } from "./agents/research.agent.ts";
import { createWebAgent } from "./agents/web.agent.ts";
import { chatInstructions } from "./prompts/chat.instructions.ts";
import {
  AgentContextValidationError,
  buildAgentRunInput,
  buildCucumberAgentContext,
  hydrateAgentRunInputArtifacts,
  type AgentRunInput,
  type AgentRuntime,
  type CucumberAgentContext,
  type CucumberRunEvent,
  type CucumberTextDeltaSource,
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
  prewarmInputNormalizer,
} from "./input-normalizer.ts";
import { selectAgentRoute } from "./task-router.ts";
import {
  materializeAgentRunSnapshot,
  shouldBlockRunForMaterialization,
  shouldMaterializeRunEvent,
} from "./materialize-run.ts";
import { getAgentRunnerConfig } from "./model-config.ts";
import { retrieveRelevantAgentSkills } from "./skills/skill-retrieval.ts";
import { getAgentSkillRegistryCacheState } from "./skills/skill-registry.ts";
import type { ActivatedAgentSkill } from "./skills/types.ts";
import { resolveStorageBackedImageContext } from "../storage.ts";
import { getAgentSkillDefinition } from "../supabase.ts";
import { buildRunPlan } from "./run-plan.ts";
import { redactTraceValue } from "./trace-redaction.ts";
import { getToolTraceMetadata } from "./tool-registry.ts";
import {
  routeAgentRunQuick,
  routeNormalizedAgentRun,
  skippedStepsForNormalizedRoute,
  type AgentRunRoute,
  type QuickAgentRunRoute,
} from "./quick-router.ts";
import { validateCanvasOperations } from "./policy/canvas-operation-policy.ts";

let runner: Runner | undefined;
let chatRunner: Runner | undefined;
let chatAgent: Agent<CucumberAgentContext> | undefined;

const MAX_RUN_INPUT_IMAGES = 4;

type RunPhase = "prepare" | "route" | "execute" | "materialize";

type RunPhaseTimer = {
  label: string;
  phase: RunPhase;
  startedAt: string;
  startedMs: number;
  stepId: string;
};

export class OpenAIAgentsRuntime implements AgentRuntime {
  async *run(input: AgentRunInput): AsyncIterable<CucumberRunEvent> {
    const normalizedInput =
      input.normalizedInput ??
      (await normalizeAgentInput(input, { signal: input.signal }));
    const normalizedRunInput = { ...input, normalizedInput };
    const context = buildCucumberAgentContext(normalizedRunInput);
    const skillPhase = startRunPhase(
      "skills.retrieve",
      "检索可用技能",
      "route"
    );
    const skillRegistryWasCached = getAgentSkillRegistryCacheState().cached;
    const skillTask = settlePromise(retrieveRelevantAgentSkills(normalizedRunInput));

    yield runPhaseStarted(skillPhase);
    try {
      const skillResult = await skillTask;
      if (skillResult.status === "rejected") {
        throw skillResult.reason;
      }
      context.skillCandidates = skillResult.value;
      yield runPhaseCompleted(skillPhase, {
        cacheHit: skillRegistryWasCached,
        candidateCount: context.skillCandidates.length,
      });
    } catch (error) {
      yield runPhaseFailed(skillPhase, error);
      throw error;
    }
    yield { type: "skill_retrieved", candidates: context.skillCandidates };
    const forcedSkill = await activateForcedSkillForRun(context);
    if (forcedSkill) {
      yield {
        type: "skill_activated",
        skill: {
          agentScope: forcedSkill.agentScope,
          id: forcedSkill.id,
          name: forcedSkill.name,
          purpose: forcedSkill.purpose,
          scripts: forcedSkill.scripts,
          tags: forcedSkill.tags,
        },
      };
    }
    const startAgent = createStartingAgentForRun(normalizedInput);

    const agentStartPhase = startRunPhase(
      "agent.start",
      "启动 Agent Runner",
      "route"
    );
    const maxTurns = 8;
    yield runPhaseStarted(agentStartPhase, {
      agentName: startAgent.name,
    });
    let stream;
    try {
      const prompt = buildManagerRunPrompt(normalizedRunInput);
      const runnerInput = await buildAgentRunnerInput(normalizedRunInput, prompt);
      stream = await getAgentRunner().run(startAgent, runnerInput, {
        context,
        maxTurns,
        signal: input.signal,
        stream: true,
      });
      yield runPhaseCompleted(agentStartPhase, {
        agentName: startAgent.name,
        maxTurns,
      });
    } catch (error) {
      yield runPhaseFailed(agentStartPhase, error, {
        agentName: startAgent.name,
        maxTurns,
      });
      throw error;
    }
    yield* openAIStreamToCucumberEvents(stream, context);
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

export async function* runChatAgent(
  input: AgentRunInput
): AsyncIterable<CucumberRunEvent> {
  const context = buildCucumberAgentContext(input);
  const chatPhase = startRunPhase("chat.start", "启动 Chat Agent", "execute");
  yield runPhaseStarted(chatPhase, {
    route: "chat_agent_task",
  });
  let stream;
  try {
    stream = await getChatRunner().run(
      getChatAgent(),
      buildChatPrompt(input),
      {
        context,
        maxTurns: 1,
        signal: input.signal,
        stream: true,
      }
    );
    yield runPhaseCompleted(chatPhase, {
      route: "chat_agent_task",
    });
  } catch (error) {
    yield runPhaseFailed(chatPhase, error, {
      route: "chat_agent_task",
    });
    throw error;
  }
  yield* openAIStreamToCucumberEvents(stream, context);
}

export function prewarmAgentRuntimeWorld() {
  getAgentRunner();
  getChatRunner();
  getChatAgent();
  prewarmInputNormalizer();
  createManagerAgent();
  createImageAgent();
  createDocumentAgent();
  createResearchAgent();
  createWebAgent();
}

function getChatRunner() {
  chatRunner ??= new Runner({
    workflowName: "Cucumber Chat",
    ...getAgentRunnerConfig(),
  });
  return chatRunner;
}

function getChatAgent() {
  chatAgent ??= new Agent<CucumberAgentContext>({
    name: "Cucumber Chat Agent",
    instructions: (runContext) => chatInstructions(runContext.context),
  });
  return chatAgent;
}

function startRunPhase(
  stepId: string,
  label: string,
  phase: RunPhase
): RunPhaseTimer {
  return {
    label,
    phase,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    stepId,
  };
}

function runPhaseStarted(
  timer: RunPhaseTimer,
  details?: Record<string, unknown>
): CucumberRunEvent {
  return {
    type: "run_phase_started",
    details,
    label: timer.label,
    phase: timer.phase,
    startedAt: timer.startedAt,
    stepId: timer.stepId,
  };
}

function runPhaseCompleted(
  timer: RunPhaseTimer,
  details?: Record<string, unknown>
): CucumberRunEvent {
  return {
    type: "run_phase_completed",
    completedAt: new Date().toISOString(),
    details,
    durationMs: elapsedRunPhaseMs(timer),
    label: timer.label,
    phase: timer.phase,
    startedAt: timer.startedAt,
    stepId: timer.stepId,
  };
}

function runPhaseFailed(
  timer: RunPhaseTimer,
  error: unknown,
  details?: Record<string, unknown>
): CucumberRunEvent {
  return {
    type: "run_phase_failed",
    details,
    durationMs: elapsedRunPhaseMs(timer),
    errorText: getAgentErrorMessage(error),
    failedAt: new Date().toISOString(),
    label: timer.label,
    phase: timer.phase,
    startedAt: timer.startedAt,
    stepId: timer.stepId,
  };
}

function elapsedRunPhaseMs(timer: RunPhaseTimer) {
  return Math.max(0, Date.now() - timer.startedMs);
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

async function settlePromise<T>(promise: Promise<T>) {
  try {
    return { status: "fulfilled" as const, value: await promise };
  } catch (reason) {
    return { status: "rejected" as const, reason };
  }
}

async function activateForcedSkillForRun(
  context: CucumberAgentContext
): Promise<ActivatedAgentSkill | null> {
  if (!context.forcedSkillId) {
    return null;
  }

  const candidate = context.skillCandidates.find(
    (skill) => skill.id === context.forcedSkillId
  );
  if (!candidate) {
    throw new Error("Selected skill was not retrieved.");
  }

  const fullSkill = await getAgentSkillDefinition(candidate.id);
  if (!fullSkill || !fullSkill.enabled) {
    throw new Error("Selected skill is not available.");
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
  return activated;
}

function shouldWriteRunPlan(route: AgentRunRoute, itemCount: number) {
  return route === "manager_task" || route === "image_task" || itemCount > 0;
}

function routeForRuntimeNormalizedInput(
  input: AgentRunInput,
  normalizedInput: NonNullable<AgentRunInput["normalizedInput"]>,
  options: { allowSimpleChat?: boolean } = {}
): AgentRunRoute {
  return routeNormalizedAgentRun(input, normalizedInput, options);
}

function applyForcedSkillRoute(
  input: AgentRunInput,
  route: QuickAgentRunRoute
): QuickAgentRunRoute {
  if (!input.forcedSkillId) {
    return route;
  }

  return {
    ...route,
    canvasOperations: undefined,
    fallbackReason: route.fallbackReason ?? "forced_skill",
    route: route.normalizedInput
      ? routeForRuntimeNormalizedInput(input, route.normalizedInput, {
          allowSimpleChat: false,
        })
      : "manager_task",
    skippedSteps: route.normalizedInput ? ["input.normalize"] : [],
  };
}

export async function buildAgentRunnerInput(
  input: AgentRunInput,
  prompt: string
): Promise<string | AgentInputItem[]> {
  const images = await resolveModelInputImages(input.upstreamContext, input.selectedNodeIds);
  if (!images.length) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...images.map((image) => ({
          type: "input_image" as const,
          image: image.imageUrl,
          detail: "auto",
        })),
      ],
    },
  ];
}

async function resolveModelInputImages(
  upstreamContext: UpstreamContextItem[],
  selectedNodeIds: string[]
) {
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const imageItems = upstreamContext
    .filter((item): item is UpstreamContextItem & { type: "image" } =>
      item.type === "image"
    )
    .sort((left, right) => {
      const leftSelected = selectedNodeIdSet.has(left.nodeId) ? 0 : 1;
      const rightSelected = selectedNodeIdSet.has(right.nodeId) ? 0 : 1;
      return leftSelected - rightSelected || (left.priority ?? 0) - (right.priority ?? 0);
    })
    .slice(0, MAX_RUN_INPUT_IMAGES);
  if (!imageItems.length) {
    return [];
  }

  const resolved = await resolveStorageBackedImageContext(imageItems);
  return resolved.filter(
    (item): item is UpstreamContextItem & { type: "image"; imageUrl: string } =>
      item.type === "image" && isModelReadableImageUrl(item.imageUrl)
  );
}

function isModelReadableImageUrl(value: string | undefined) {
  return Boolean(value && /^(https?:\/\/|data:image\/)/i.test(value));
}

export async function executeAgentRun({
  writer: streamWriter,
  ...input
}: ExecuteAgentRunInput) {
  const runStartedMs = Date.now();
  const eventWriter = createAgentEventWriter({
    projectId: input.projectId,
    runNodeId: input.runNodeId,
    writer: streamWriter,
  });
  let agentInput: AgentRunInput | null = null;
  let quickRoute: QuickAgentRunRoute | null = null;
  const textStreamId = `agent-text-${crypto.randomUUID()}`;
  const reasoningStreamId = `agent-reasoning-${crypto.randomUUID()}`;
  let messageStarted = false;
  let messageFinished = false;
  let textStarted = false;
  let reasoningStarted = false;
  let finalOutput: string | undefined;
  let artifactIds: string[] = [];
  let currentAgentName: string | undefined;
  let assistantTextContent = "";
  let activeAgentMessage:
    | {
        agentName?: string;
        deltaIndex: number;
        id: string;
        messageKind: "assistant" | "progress";
        text: string;
      }
    | null = null;
  let agentMessageCount = 0;
  let materializationQueued = false;
  let materializationDrainPromise: Promise<void> | null = null;
  const runEvents: AgentEvent[] = [];
  const activeToolTraces = new Map<
    string,
    {
      startedMs: number;
      toolName: string;
    }
  >();
  const activeToolTraceIdsByName = new Map<string, string[]>();

  const trackEvent = async (event: AgentEvent) => {
    runEvents.push(event);
    if (shouldMaterializeRunEvent(event.type)) {
      if (
        shouldDeferRunMaterialization() ||
        !shouldBlockRunForMaterialization(event.type)
      ) {
        scheduleMaterializeRun();
      } else {
        await flushQueuedMaterializeRun();
      }
    }
    return event;
  };

  const writeRunEvent = async (
    event: Omit<AgentEvent, "createdAt"> & { createdAt?: string }
  ) => trackEvent(await eventWriter.writeEvent(event));

  const writeRunPhaseEvent = async (event: CucumberRunEvent) => {
    if (event.type === "run_phase_started") {
      await writeRunEvent({
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        stepId: event.stepId,
        type: "run.step.started",
        payload: buildRunPhasePayload(event),
      });
      return;
    }

    if (event.type === "run_phase_completed") {
      await writeRunEvent({
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        stepId: event.stepId,
        type: "run.step.completed",
        payload: buildRunPhasePayload(event),
      });
      return;
    }

    if (event.type === "run_phase_failed") {
      await writeRunEvent({
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        stepId: event.stepId,
        type: "run.step.failed",
        payload: buildRunPhasePayload(event),
        errorText: event.errorText,
      });
    }
  };

  const flushAndMaterializeRun = async () => {
    await eventWriter.flush();
    await materializeAgentRunSnapshot({
      events: runEvents,
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      userId: input.userId,
    });
  };

  const scheduleMaterializeRun = () => {
    materializationQueued = true;
    void ensureMaterializeDrain();
  };

  const flushQueuedMaterializeRun = async () => {
    materializationQueued = true;
    await ensureMaterializeDrain();
  };

  const ensureMaterializeDrain = () => {
    materializationDrainPromise ??= drainMaterializeRunQueue().finally(() => {
      materializationDrainPromise = null;
      if (materializationQueued) {
        void ensureMaterializeDrain();
      }
    });
    return materializationDrainPromise;
  };

  const drainMaterializeRunQueue = async () => {
    while (materializationQueued) {
      materializationQueued = false;
      await flushAndMaterializeRun().catch((error: unknown) => {
        console.error("[agent-run:materialize]", error);
      });
    }
  };

  const shouldDeferRunMaterialization = () =>
    quickRoute?.route === "chat_agent_task" ||
    quickRoute?.route === "simple_canvas";

  try {
    const contextPhase = startRunPhase(
      "context.build",
      "重建可信画布上下文",
      "prepare"
    );
    agentInput = await hydrateAgentRunInputArtifacts(buildAgentRunInput(input));
    quickRoute = routeAgentRunQuick(agentInput);
    quickRoute = applyForcedSkillRoute(agentInput, quickRoute);
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.created",
      payload: buildRedactedPayload({
        canvasPatchApplied: agentInput.canvasPatchApplied || undefined,
        imageAspectRatio: agentInput.imageAspectRatio,
        imageResultCount: agentInput.imageResultCount,
        imageProvider: agentInput.imageProvider,
        inputMode: agentInput.inputMode,
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        projectVersion: agentInput.projectVersion,
        selectedNodeId: agentInput.selectedNodeId,
        selectedNodeIds: agentInput.selectedNodeIds,
        contextSummary: agentInput.contextSummary,
        upstreamContext: agentInput.upstreamContext,
        route: quickRoute.route,
        routerSource: quickRoute.routerSource,
        skippedSteps: quickRoute.skippedSteps,
        routeFallbackReason: quickRoute.fallbackReason,
        runtime: "openai-agents-sdk",
      }),
    });
    await writeRunPhaseEvent(
      runPhaseCompleted(contextPhase, {
        edgeCount: agentInput.canvasSnapshot.edges.length,
        nodeCount: agentInput.canvasSnapshot.nodes.length,
        selectedNodeCount: agentInput.selectedNodeIds.length,
        upstreamContextCount: agentInput.upstreamContext.length,
      })
    );

    const routePhase = startRunPhase(
      "quick.route",
      "整理用户需求",
      "prepare"
    );
    await writeRunPhaseEvent(runPhaseStarted(routePhase, {
      route: quickRoute.route,
      routerSource: quickRoute.routerSource,
    }));
    await writeRunPhaseEvent(
      runPhaseCompleted(routePhase, {
        route: quickRoute.route,
        routerSource: quickRoute.routerSource,
        skippedSteps: quickRoute.skippedSteps,
        routeFallbackReason: quickRoute.fallbackReason,
      })
    );

    if (quickRoute.normalizedInput && !quickRoute.requiresModelNormalization) {
      agentInput = {
        ...agentInput,
        normalizedInput: quickRoute.normalizedInput,
      };
    } else {
      const normalizePhase = startRunPhase(
        "input.normalize",
        "整理用户需求",
        "prepare"
      );
      await writeRunPhaseEvent(runPhaseStarted(normalizePhase, {
        route: quickRoute.route,
        routerSource: quickRoute.routerSource,
        routeFallbackReason: quickRoute.fallbackReason,
      }));
      try {
        const normalizedInput = await normalizeAgentInput(agentInput, {
          signal: input.signal,
        });
        agentInput = {
          ...agentInput,
          normalizedInput,
        };
        const route = routeForRuntimeNormalizedInput(agentInput, normalizedInput, {
          allowSimpleChat: !agentInput.forcedSkillId,
        });
        quickRoute = {
          ...quickRoute,
          route,
          routerSource: "llm-normalizer",
          skippedSteps: skippedStepsForNormalizedRoute(route),
        };
      } catch (error) {
        await writeRunPhaseEvent(runPhaseFailed(normalizePhase, error, {
          route: quickRoute.route,
          routerSource: quickRoute.routerSource,
        }));
        throw error;
      }
      const modelNormalizedInput = agentInput.normalizedInput;
      await writeRunPhaseEvent(
        runPhaseCompleted(normalizePhase, {
          intent: modelNormalizedInput?.task.intent,
          action: modelNormalizedInput?.task.action,
          domain: modelNormalizedInput?.task.domain,
          primaryAgent: modelNormalizedInput?.routing.primaryAgent,
          route: quickRoute.route,
          routerSource: quickRoute.routerSource,
          routeFallbackReason: quickRoute.fallbackReason,
        })
      );
    }
    const normalizedInput = agentInput.normalizedInput;
    if (!normalizedInput) {
      throw new Error("Input normalization did not produce a normalized input.");
    }
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "input",
      type: "input.normalized",
      payload: buildRedactedPayload({
        normalizedInput: agentInput.normalizedInput,
        imageAspectRatio: agentInput.imageAspectRatio,
        imageResultCount: agentInput.imageResultCount,
        imageProvider: agentInput.imageProvider,
        inputMode: agentInput.inputMode,
        prompt: agentInput.message,
        promptNodeId: agentInput.promptNodeId,
        selectedNodeId: agentInput.selectedNodeId,
        selectedNodeIds: agentInput.selectedNodeIds,
        contextSummary: agentInput.contextSummary,
        upstreamContext: agentInput.upstreamContext,
        route: quickRoute.route,
        routerSource: quickRoute.routerSource,
        skippedSteps: quickRoute.skippedSteps,
        routeFallbackReason: quickRoute.fallbackReason,
        runtime: "openai-agents-sdk",
      }),
    });

    if (quickRoute.route === "simple_canvas") {
      await executeSimpleCanvasRoute(quickRoute, agentInput);
      await completeRun();
      return;
    }

    if (quickRoute.route === "chat_agent_task") {
      await consumeRunEvents(runChatAgent(agentInput));
      await completeRun();
      return;
    }

    const runPlan = buildRunPlan(agentInput);
    if (shouldWriteRunPlan(quickRoute.route, runPlan.length)) {
      const planPhase = startRunPhase(
        "plan.build",
        "生成运行计划",
        "prepare"
      );
      await writeRunPhaseEvent(runPhaseStarted(planPhase, {
        route: quickRoute.route,
      }));
      if (runPlan.length > 0) {
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "plan",
          type: "run.plan.created",
          payload: {
            items: runPlan,
            retryFrom: agentInput.retryFrom ?? null,
            route: quickRoute.route,
            runtime: "openai-agents-sdk",
          },
        });
      }
      await writeRunPhaseEvent(
        runPhaseCompleted(planPhase, {
          itemCount: runPlan.length,
          route: quickRoute.route,
        })
      );
    }

    await consumeRunEvents(agentRuntime.run(agentInput));
    await completeRun();
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
    await finishAgentMessage();
    closeReasoningStream();
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
        imageAspectRatio: agentInput?.imageAspectRatio ?? input.canvasContext.imageAspectRatio,
        imageResultCount: agentInput?.imageResultCount ?? input.canvasContext.imageResultCount,
        imageProvider: agentInput?.imageProvider ?? input.canvasContext.imageProvider,
        inputMode: agentInput?.inputMode ?? input.canvasContext.inputMode,
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
    if (shouldDeferRunMaterialization()) {
      finishMessage("error");
      scheduleMaterializeRun();
    } else {
      await flushQueuedMaterializeRun();
      finishMessage("error");
    }
  }

  async function consumeRunEvents(events: AsyncIterable<CucumberRunEvent>) {
    for await (const event of events) {
      if (
        event.type === "run_phase_started" ||
        event.type === "run_phase_completed" ||
        event.type === "run_phase_failed"
      ) {
        await writeRunPhaseEvent(event);
        continue;
      }

      if (event.type === "text_delta") {
        await writeAgentTextDelta(event.text, event.source);
        continue;
      }

      if (event.type === "agent_active") {
        await switchActiveAgent(event.agentName);
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "agent",
          type: "agent.active",
          payload: {
            agentName: event.agentName,
            route: quickRoute?.route,
            runtime: "openai-agents-sdk",
          },
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
            cacheState: "memory",
            route: quickRoute?.route,
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
            route: quickRoute?.route,
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
            route: quickRoute?.route,
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
        await finishAgentMessage();
        await writeRunEvent({
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          stepId: "handoff",
          type: event.type === "handoff_requested" ? "handoff.requested" : "handoff.completed",
          payload: {
            fromAgent: event.fromAgent,
            route: quickRoute?.route,
            runtime: "openai-agents-sdk",
            toAgent: event.toAgent,
          },
        });
        continue;
      }

      if (event.type === "tool_started") {
        await finishAgentMessage();
        const toolCallId = startToolTrace(event.toolName, event.toolCallId);
        await trackEvent(
          await eventWriter.writeToolInput({
            stepId: event.toolName,
            toolCallId,
            toolName: event.toolName,
            toolInput: event.input ?? {},
            metadata: { runtime: "openai-agents-sdk" },
          })
        );
        continue;
      }

      if (event.type === "tool_completed") {
        const toolTrace = finishToolTrace(event.toolName, event.toolCallId);
        await trackEvent(
          await eventWriter.writeToolOutput({
            durationMs: toolTrace.durationMs,
            stepId: event.toolName,
            toolCallId: toolTrace.toolCallId,
            toolName: event.toolName,
            output: event.output ?? {},
            metadata: { runtime: "openai-agents-sdk" },
          })
        );
        continue;
      }

      if (event.type === "tool_failed") {
        const toolTrace = finishToolTrace(event.toolName, event.toolCallId);
        await trackEvent(
          await eventWriter.writeToolError({
            durationMs: toolTrace.durationMs,
            stepId: event.toolName,
            toolCallId: toolTrace.toolCallId,
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
        await writeCanvasOperationRejections(event.rejections);
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
            route: quickRoute?.route,
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
  }

  function startToolTrace(toolName: string, toolCallId: string | undefined) {
    const resolvedToolCallId = toolCallId ?? `${toolName}-${crypto.randomUUID()}`;
    activeToolTraces.set(resolvedToolCallId, {
      startedMs: Date.now(),
      toolName,
    });
    activeToolTraceIdsByName.set(toolName, [
      ...(activeToolTraceIdsByName.get(toolName) ?? []),
      resolvedToolCallId,
    ]);
    return resolvedToolCallId;
  }

  function finishToolTrace(toolName: string, toolCallId: string | undefined) {
    const matchingToolCallId =
      toolCallId && activeToolTraces.has(toolCallId)
        ? toolCallId
        : toolCallId ?? activeToolTraceIdsByName.get(toolName)?.[0];
    const resolvedToolCallId =
      matchingToolCallId ?? `${toolName}-${crypto.randomUUID()}`;
    const activeTrace = activeToolTraces.get(resolvedToolCallId);
    if (!activeTrace) {
      return { toolCallId: resolvedToolCallId };
    }

    activeToolTraces.delete(resolvedToolCallId);
    const remainingToolIds = (activeToolTraceIdsByName.get(activeTrace.toolName) ?? [])
      .filter((id) => id !== resolvedToolCallId);
    if (remainingToolIds.length) {
      activeToolTraceIdsByName.set(activeTrace.toolName, remainingToolIds);
    } else {
      activeToolTraceIdsByName.delete(activeTrace.toolName);
    }

    return {
      durationMs: Math.max(0, Math.round(Date.now() - activeTrace.startedMs)),
      toolCallId: resolvedToolCallId,
    };
  }

  async function executeSimpleCanvasRoute(
    route: QuickAgentRunRoute,
    inputForRun: AgentRunInput
  ) {
    const context = buildCucumberAgentContext(inputForRun);
    const validation = validateCanvasOperations({
      knownNodeIds: context.knownNodeIds,
      operations: route.canvasOperations ?? [],
      projectId: input.projectId,
      runNodeId: input.runNodeId,
    });
    const accepted = validation.accepted.map((item) => item.operation);
    if (accepted.length) {
      for (const type of ["canvas.operation.proposed", "canvas.operation.applied"] as const) {
        const writtenEvents = await writeCanvasOperationEvents({
          operations: accepted,
          projectId: input.projectId,
          runNodeId: input.runNodeId,
          type,
          writer: eventWriter,
        });
        for (const writtenEvent of writtenEvents) {
          await trackEvent(writtenEvent);
        }
      }
    }
    if (validation.rejected.length) {
      await writeCanvasOperationRejections(validation.rejected);
    }
    if (!accepted.length) {
      throw new Error("Simple canvas operation was rejected by policy.");
    }
    finalOutput = "已在画布上完成操作。";
    await writeAgentTextDelta(finalOutput);
  }

  async function writeCanvasOperationRejections(
    rejections: Array<{ operation: CanvasOperation; reason: string }>
  ) {
    for (const rejected of rejections) {
      await writeRunEvent({
        projectId: input.projectId,
        runNodeId: input.runNodeId,
        stepId: "canvas-policy",
        type: "canvas.operation.rejected",
        payload: {
          operation: rejected.operation,
          reason: rejected.reason,
          route: quickRoute?.route,
          runtime: "openai-agents-sdk",
        },
        errorText: `Canvas operation ${rejected.operation.id} was rejected: ${rejected.reason}.`,
      });
    }
  }

  async function completeRun() {
    await finishAgentMessage();
    if (
      finalOutput?.trim() &&
      !textAlreadyIncludesFinalOutput(assistantTextContent, finalOutput)
    ) {
      await writeAgentTextDelta(finalOutput);
      await finishAgentMessage();
    }
    closeReasoningStream();
    closeTextStream();
    if (!shouldDeferRunMaterialization()) {
      await eventWriter.flush();
    }
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "run",
      type: "run.completed",
      payload: {
        artifactIds,
        durationMs: Math.max(0, Math.round(Date.now() - runStartedMs)),
        finalOutput,
        route: quickRoute?.route,
        routerSource: quickRoute?.routerSource,
        runtime: "openai-agents-sdk",
        status: "completed",
      },
    });
    finishMessage("stop");
  }

  function writeTextDelta(text: string) {
    ensureMessageStarted();
    if (!textStarted) {
      textStarted = true;
      writeStreamPart({ type: "start-step" });
      writeStreamPart({ type: "text-start", id: textStreamId });
    }
    writeStreamPart({ type: "text-delta", id: textStreamId, delta: text });
  }

  async function writeAgentTextDelta(
    text: string,
    source?: CucumberTextDeltaSource
  ) {
    if (source === "reasoning_summary") {
      writeReasoningDelta(text);
      await writeAgentMessageDelta(text, "progress", source);
      return;
    }

    closeReasoningStream();
    writeTextDelta(text);
    await writeAgentMessageDelta(text, "assistant", source);
  }

  async function switchActiveAgent(agentName: string) {
    if (
      activeAgentMessage?.text.trim() &&
      activeAgentMessage.agentName &&
      activeAgentMessage.agentName !== agentName
    ) {
      await finishAgentMessage();
    }
    currentAgentName = agentName;
    if (activeAgentMessage && !activeAgentMessage.agentName) {
      activeAgentMessage.agentName = agentName;
    }
  }

  async function writeAgentMessageDelta(
    delta: string,
    messageKind: "assistant" | "progress",
    source?: CucumberTextDeltaSource
  ) {
    if (!delta) {
      return;
    }
    if (
      activeAgentMessage &&
      activeAgentMessage.messageKind !== messageKind &&
      activeAgentMessage.text.trim()
    ) {
      await finishAgentMessage();
    }
    const message = getActiveAgentMessage(messageKind);
    const index = message.deltaIndex;
    message.deltaIndex += 1;
    message.text += delta;
    if (messageKind === "assistant") {
      assistantTextContent += delta;
    }
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "agent-message",
      type: "agent.message.delta",
      payload: {
        agentName: message.agentName,
        delta,
        index,
        messageKind,
        messageId: message.id,
        role: "assistant",
        runtime: "openai-agents-sdk",
        source,
      },
    });
  }

  async function finishAgentMessage() {
    const message = activeAgentMessage;
    if (!message) {
      return;
    }
    activeAgentMessage = null;
    const content = message.text;
    if (!content.trim()) {
      return;
    }
    await writeRunEvent({
      projectId: input.projectId,
      runNodeId: input.runNodeId,
      stepId: "agent-message",
      type: "agent.message.completed",
      payload: {
        agentName: message.agentName,
        content,
        messageKind: message.messageKind,
        messageId: message.id,
        role: "assistant",
        runtime: "openai-agents-sdk",
        status: "completed",
      },
    });
  }

  function getActiveAgentMessage(messageKind: "assistant" | "progress") {
    if (!activeAgentMessage) {
      agentMessageCount += 1;
      activeAgentMessage = {
        agentName: currentAgentName,
        deltaIndex: 0,
        id: `${input.runNodeId}-agent-message-${agentMessageCount}`,
        messageKind,
        text: "",
      };
    }
    return activeAgentMessage;
  }

  function closeTextStream() {
    if (!textStarted) {
      return;
    }
    writeStreamPart({ type: "text-end", id: textStreamId });
    writeStreamPart({ type: "finish-step" });
    textStarted = false;
  }

  function writeReasoningDelta(text: string) {
    ensureMessageStarted();
    if (!reasoningStarted) {
      reasoningStarted = true;
      writeStreamPart({ type: "start-step" });
      writeStreamPart({ type: "reasoning-start", id: reasoningStreamId });
    }
    writeStreamPart({
      type: "reasoning-delta",
      id: reasoningStreamId,
      delta: text,
    });
  }

  function closeReasoningStream() {
    if (!reasoningStarted) {
      return;
    }
    writeStreamPart({ type: "reasoning-end", id: reasoningStreamId });
    writeStreamPart({ type: "finish-step" });
    reasoningStarted = false;
  }

  function ensureMessageStarted() {
    if (messageStarted) {
      return;
    }
    writeStreamPart({ type: "start" });
    messageStarted = true;
  }

  function finishMessage(finishReason: "error" | "stop") {
    if (!messageStarted || messageFinished) {
      return;
    }
    writeStreamPart({ type: "finish", finishReason });
    messageFinished = true;
  }

  function writeStreamPart(part: Parameters<typeof streamWriter.write>[0]) {
    try {
      streamWriter.write(part);
    } catch {
      // The run can continue after the user leaves; persisted events hydrate UI.
    }
  }
}

function textAlreadyIncludesFinalOutput(text: string, finalOutput: string) {
  const normalizedText = normalizeAssistantText(text);
  const normalizedFinalOutput = normalizeAssistantText(finalOutput);
  return Boolean(
    normalizedFinalOutput &&
      (normalizedText === normalizedFinalOutput ||
        normalizedText.endsWith(normalizedFinalOutput) ||
        normalizedText.includes(normalizedFinalOutput))
  );
}

function normalizeAssistantText(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

  if (/byteartist/i.test(message)) {
    return {
      errorCode: "byteartist_failed",
      errorSource: "byteartist",
    };
  }

  if (/seedream/i.test(message) || /generate_image|image_matting|upscale_image/.test(toolName)) {
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

function buildRunPhasePayload(
  event: Extract<
    CucumberRunEvent,
    | { type: "run_phase_started" }
    | { type: "run_phase_completed" }
    | { type: "run_phase_failed" }
  >
) {
  return buildRedactedPayload({
    details: event.details,
    durationMs: "durationMs" in event ? event.durationMs : undefined,
    completedAt: "completedAt" in event ? event.completedAt : undefined,
    failedAt: "failedAt" in event ? event.failedAt : undefined,
    errorText: "errorText" in event ? event.errorText : undefined,
    label: event.label,
    phase: event.phase,
    runtime: "openai-agents-sdk",
    startedAt: event.startedAt,
  });
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

function buildChatPrompt(input: AgentRunInput) {
  return [
    `User request: ${input.message}`,
    input.normalizedInput
      ? `Normalized input: ${JSON.stringify(input.normalizedInput)}`
      : "",
    "Answer directly and concisely. Do not create canvas artifacts or claim that tools were used.",
  ].filter(Boolean).join("\n\n");
}
