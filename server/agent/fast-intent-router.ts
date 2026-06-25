import { Agent, Runner } from "@openai/agents";
import { z } from "zod";

import type { AgentRunInput } from "./context.ts";
import {
  buildCompactAgentCapabilityManifest,
  getAgentCapabilityRoute,
} from "./agent-capability-manifest.ts";
import {
  finalizeNormalizedAgentInput,
  taskArtifactFormatValues,
  taskArtifactKindValues,
  taskArtifactSubtypeValues,
  taskDomainValues,
  taskOperationValues,
  type NormalizedAgentInput,
} from "./input-normalizer.ts";
import { getAgentRunnerConfig } from "./model-config.ts";
import {
  isImageArtifactTask,
  selectAgentRoute,
  selectAgentRoutesForTask,
} from "./task-router.ts";
import { getToolRegistryEntry } from "./tool-registry.ts";
import type {
  AgentRunRoute,
  QuickAgentRunRoute,
} from "./quick-router.ts";

export const FAST_ROUTE_CONFIDENCE_THRESHOLD = 0.78;
const FAST_ROUTE_TIMEOUT_MS = 800;

const specialistRouteSchema = z.enum([
  "manager",
  "document",
  "image",
  "research",
  "web",
]);

const fastRouteArtifactSchema = z.object({
  kind: z.enum(taskArtifactKindValues),
  subtype: z.enum(taskArtifactSubtypeValues).nullable().optional(),
  format: z.enum(taskArtifactFormatValues).nullable().optional(),
});

export const fastRouteDecisionSchema = z.object({
  userGoal: z.string().trim().min(1).optional(),
  operation: z.enum(taskOperationValues),
  artifact: fastRouteArtifactSchema.nullable(),
  domain: z.enum(taskDomainValues).optional(),
  requiredCapabilities: z.array(z.string().trim().min(1)).default([]),
  negativeCapabilities: z.array(z.string().trim().min(1)).default([]),
  preferredRoute: specialistRouteSchema,
  candidateTools: z.array(z.string().trim().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  needsFullNormalization: z.boolean(),
  reason: z.string().trim().min(1).optional(),
});

export type FastRouteDecision = z.infer<typeof fastRouteDecisionSchema>;

type RouteAgentRunFastOptions = {
  decision?: unknown;
  maxOutputImages?: number;
  signal?: AbortSignal;
  threshold?: number;
  timeoutMs?: number;
};

let fastRouterRunner: Runner | undefined;
let fastRouterAgent:
  | Agent<unknown, typeof fastRouteDecisionSchema>
  | undefined;

const routeOnlySkippedSteps = ["input.normalize"];
const simpleModelSkippedSteps = [
  "input.normalize",
  "plan.build",
  "skills.retrieve",
];
const simpleImageSkippedSteps = ["input.normalize", "skills.retrieve"];

export async function routeAgentRunFast(
  input: AgentRunInput,
  options: RouteAgentRunFastOptions = {}
): Promise<QuickAgentRunRoute> {
  try {
    const candidate =
      options.decision ??
      (await runFastRouterAgent(input, {
        signal: options.signal ?? input.signal,
        timeoutMs: options.timeoutMs,
      }));

    return finalizeFastRouteDecision(candidate, input, {
      maxOutputImages: options.maxOutputImages,
      threshold: options.threshold,
    });
  } catch (error) {
    if (input.signal?.aborted || options.signal?.aborted) {
      throw error;
    }
    return fastRouteFallback(formatFastRouteError(error), undefined);
  }
}

export function finalizeFastRouteDecision(
  candidate: unknown,
  input: AgentRunInput,
  options: Pick<RouteAgentRunFastOptions, "maxOutputImages" | "threshold"> = {}
): QuickAgentRunRoute {
  const parsed = fastRouteDecisionSchema.parse(candidate);
  const normalizedInput = finalizeNormalizedAgentInput(
    {
      rawPrompt: input.message,
      userGoal: parsed.userGoal ?? input.message,
      operation: parsed.operation,
      artifact: parsed.artifact,
      domain: parsed.domain,
      requiredCapabilities: parsed.requiredCapabilities,
      negativeCapabilities: parsed.negativeCapabilities,
    },
    input.message,
    { maxOutputImages: options.maxOutputImages }
  );
  const fallbackReason = findFastRouteFallbackReason(
    parsed,
    normalizedInput,
    options.threshold ?? FAST_ROUTE_CONFIDENCE_THRESHOLD
  );
  if (fallbackReason) {
    return fastRouteFallback(fallbackReason, parsed);
  }

  const route = routeForNormalizedInput(input, normalizedInput);
  return {
    candidateTools: parsed.candidateTools,
    confidence: parsed.confidence,
    normalizedInput,
    preferredRoute: parsed.preferredRoute,
    requiresModelNormalization: false,
    route,
    routerSource: "fast-intent-router",
    skippedSteps: skippedStepsForAcceptedRoute(input, normalizedInput, route),
  };
}

export function buildFastRouterPrompt(input: AgentRunInput) {
  const upstreamSummary = input.upstreamContext
    .map(({ contentFormat, mimeType, nodeId, prompt, summary, title, type }) => ({
      contentFormat,
      mimeType,
      nodeId,
      prompt,
      summary,
      title,
      type,
    }))
    .slice(0, 8);

  return [
    `User request: ${input.message}`,
    `Input mode: ${input.inputMode ?? "agent"}`,
    `Selected node id: ${input.selectedNodeId ?? "none"}`,
    `Selected node ids: ${JSON.stringify(input.selectedNodeIds)}`,
    `Image controls: ${JSON.stringify({
      aspectRatio: input.imageAspectRatio,
      resultCount: input.imageResultCount,
      provider: input.imageProvider,
    })}`,
    `Trusted upstream context summary: ${JSON.stringify(upstreamSummary)}`,
    `Current agent/tool capability manifest: ${JSON.stringify(
      buildCompactAgentCapabilityManifest()
    )}`,
  ].join("\n\n");
}

export function prewarmFastIntentRouter() {
  getFastRouterRunner();
  createFastRouterAgent();
}

function createFastRouterAgent() {
  fastRouterAgent ??= new Agent({
    name: "Cucumber Fast Intent Router",
    instructions: [
      "You are a fast capability-aware router for Cucumber Agent runs.",
      "Do not execute tasks, call tools, or produce user-facing text.",
      "Return only the structured route decision.",
      "Use the provided capability manifest as the source of truth for available agents, tools, artifacts, and capabilities.",
      "Route by operation, artifact, domain, requiredCapabilities, and negativeCapabilities. Do not rely on legacy intent names.",
      "Questions asking about tools, models, APIs, SDKs, providers, platforms, open-source/free resources, or services are usually plain answers with artifact=null, preferredRoute=manager, and negativeCapabilities including image-generation.",
      "Questions about why/how image generation works, fails, costs, speed, models, APIs, code, implementation, or capability are not image creation requests unless the user explicitly asks to create/render a new image artifact.",
      "Requests for reusable text deliverables such as templates, prompt templates, complete prompts, copy-ready/direct-use plans, specs, drafts, or IP 三视图模板 should use artifact.kind=document or markdown, preferredRoute=document, and negativeCapabilities including image-generation.",
      "Requests to generate/create/render an actual image should use artifact.kind=image and preferredRoute=image only when the request has both an image artifact target and a creation/rendering action, or when inputMode=image is provided.",
      "Requests for HTML/H5 demos or animations should use artifact.kind=webpage, artifact.format=html, preferredRoute=document, and negativeCapabilities including image-generation.",
      "Requests to analyze or understand an actual selected/upstream image should use preferredRoute=image with media-analysis or image-decompose, unless the user asks only for generation metadata.",
      "Use needsFullNormalization=true when selected context edits are ambiguous, the task combines multiple unrelated operations, or the output slots need careful extraction.",
      "Use confidence >= 0.78 only when the route and required capabilities are clear from the prompt and trusted context.",
    ].join("\n"),
    outputType: fastRouteDecisionSchema,
  });
  return fastRouterAgent;
}

function getFastRouterRunner() {
  fastRouterRunner ??= new Runner({
    workflowName: "Cucumber Fast Intent Router",
    ...getAgentRunnerConfig(),
  });
  return fastRouterRunner;
}

async function runFastRouterAgent(
  input: AgentRunInput,
  options: { signal?: AbortSignal; timeoutMs?: number }
) {
  const abort = createTimeoutSignal(options.signal, options.timeoutMs);
  try {
    const result = await getFastRouterRunner().run(
      createFastRouterAgent(),
      buildFastRouterPrompt(input),
      {
        maxTurns: 1,
        signal: abort.signal,
      }
    );
    if (!result.finalOutput) {
      throw new Error("Fast intent router did not produce a structured result.");
    }
    return result.finalOutput;
  } finally {
    abort.cleanup();
  }
}

function findFastRouteFallbackReason(
  decision: FastRouteDecision,
  normalizedInput: NormalizedAgentInput,
  threshold: number
) {
  if (decision.needsFullNormalization) {
    return "model_requested_full_normalization";
  }
  if (decision.confidence < threshold) {
    return `low_confidence:${decision.confidence.toFixed(2)}`;
  }
  const unknownTools = decision.candidateTools.filter(
    (toolName) => !getToolRegistryEntry(toolName)
  );
  if (unknownTools.length) {
    return `unknown_tools:${unknownTools.join(",")}`;
  }
  const selectedRoutes = selectAgentRoutesForTask(normalizedInput);
  if (decision.preferredRoute === "manager") {
    if (selectedRoutes.length > 0) {
      return `route_conflict:manager_vs_${selectedRoutes.join("+")}`;
    }
    return null;
  }
  if (
    selectedRoutes.length > 0 &&
    !selectedRoutes.includes(decision.preferredRoute)
  ) {
    return `route_conflict:${decision.preferredRoute}_vs_${selectedRoutes.join(
      "+"
    )}`;
  }
  const preferredCapability = getAgentCapabilityRoute(decision.preferredRoute);
  if (!preferredCapability) {
    return `unknown_route:${decision.preferredRoute}`;
  }
  const requiredCapabilities = normalizedInput.requiredCapabilities ?? [];
  const hasRouteCapability = requiredCapabilities.some((capability) =>
    preferredCapability.requiredCapabilities.includes(capability)
  );
  const artifactKind = normalizedInput.artifact?.kind;
  const hasRouteArtifact =
    artifactKind && preferredCapability.artifactKinds.includes(artifactKind);
  if (!hasRouteCapability && !hasRouteArtifact) {
    return `capability_mismatch:${decision.preferredRoute}`;
  }
  return null;
}

function fastRouteFallback(
  fallbackReason: string,
  decision: FastRouteDecision | undefined
): QuickAgentRunRoute {
  return {
    candidateTools: decision?.candidateTools,
    confidence: decision?.confidence,
    fallbackReason,
    preferredRoute: decision?.preferredRoute,
    requiresModelNormalization: true,
    route: "complex_agent_task",
    routerSource: "fast-intent-router",
    skippedSteps: [],
  };
}

function routeForNormalizedInput(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput
): AgentRunRoute {
  if (isImageArtifactTask(normalizedInput)) {
    return "image_task";
  }
  if (isSimpleChatRun(input, normalizedInput)) {
    return "simple_chat";
  }
  return "complex_agent_task";
}

function skippedStepsForAcceptedRoute(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput,
  route: AgentRunRoute
) {
  if (route === "simple_chat") {
    return simpleModelSkippedSteps;
  }
  if (
    route === "image_task" &&
    isSimpleImageFastPathInput(input, normalizedInput)
  ) {
    return simpleImageSkippedSteps;
  }
  return routeOnlySkippedSteps;
}

function isSimpleChatRun(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput
) {
  const prompt = normalizeText(input.message);
  if (input.retryFrom || input.selectedNodeIds.length || input.upstreamContext.length) {
    return false;
  }
  if (normalizedInput.artifact || selectAgentRoute(normalizedInput) !== "manager") {
    return false;
  }
  if (normalizedInput.operation !== "answer") {
    return false;
  }
  return prompt.length <= 160;
}

function isSimpleImageFastPathInput(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput
) {
  if (input.retryFrom || input.upstreamContext.length || input.selectedNodeIds.length) {
    return false;
  }
  if (
    normalizedInput.operation !== "create" &&
    normalizedInput.intent !== "image.generate"
  ) {
    return false;
  }
  if (normalizedInput.artifact?.kind !== "image") {
    return false;
  }
  if (normalizedInput.negativeCapabilities?.includes("image-generation")) {
    return false;
  }
  return (normalizedInput.requiredCapabilities ?? []).every(
    (capability) => capability === "image-generation"
  );
}

function createTimeoutSignal(signal: AbortSignal | undefined, timeoutMs?: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("fast_intent_router_timeout"));
  }, timeoutMs ?? readFastRouteTimeoutMs());
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function readFastRouteTimeoutMs() {
  const raw = process.env.AGENT_FAST_ROUTE_TIMEOUT_MS?.trim();
  if (!raw) {
    return FAST_ROUTE_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FAST_ROUTE_TIMEOUT_MS;
}

function formatFastRouteError(error: unknown) {
  if (error instanceof z.ZodError) {
    return "schema_invalid";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "fast_intent_router_failed";
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
