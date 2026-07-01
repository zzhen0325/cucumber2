import { Agent, Runner } from "@openai/agents";
import { z } from "zod";

import { getInputNormalizerRunnerConfig } from "./model-config.ts";

// Task Frame domain/action/route vocabularies. The frame is intent-classification
// and routing only. No domain-specific tool parameters live here; each sub-agent
// derives its own final parameters from constraints.
export const taskDomainValues = [
  "image",
  "text",
  "code",
  "canvas",
  "data",
  "figma",
  "mixed",
  "web",
  "unknown",
] as const;

export const taskActionValues = [
  "create",
  "edit",
  "analyze",
  "transform",
  "extract",
  "upscale",
  "unknown",
] as const;

// Real specialist agents in the registry. canvas/code/general fold into
// manager_agent (general coordinator) and document_agent (code/diagram text).
export const primaryAgentValues = [
  "image_agent",
  "document_agent",
  "web_agent",
  "research_agent",
  "manager_agent",
] as const;

export const imageRoleValues = [
  "target",
  "reference",
  "style_reference",
  "unknown",
] as const;

export const ambiguitySeverityValues = ["low", "medium", "high"] as const;
export const workflowModeValues = [
  "single",
  "hybrid",
  "multi_step",
  "unknown",
] as const;
export const workflowModalityValues = [
  "text",
  "image",
  "code",
  "document",
  "webpage",
  "data",
  "canvas",
  "figma",
  "unknown",
] as const;
export const workflowArtifactValues = [
  "answer",
  "canvas_operation",
  "code",
  "dataset",
  "decision",
  "diagram",
  "doc",
  "file",
  "image",
  "markdown",
  "memory",
  "research",
  "tool_result",
  "webpage",
  "unknown",
] as const;

const taskDomainSchema = z.enum(taskDomainValues);
const taskActionSchema = z.enum(taskActionValues);
const primaryAgentSchema = z.enum(primaryAgentValues);
const imageRoleSchema = z.enum(imageRoleValues);
const ambiguitySeveritySchema = z.enum(ambiguitySeverityValues);
const workflowModeSchema = z.enum(workflowModeValues);
const workflowModalitySchema = z.enum(workflowModalityValues);
const workflowArtifactSchema = z.enum(workflowArtifactValues);

const taskSchema = z.object({
  domain: taskDomainSchema,
  intent: z.string().trim().min(1),
  action: taskActionSchema,
  confidence: z.number().min(0).max(1),
});

const userGoalSchema = z.object({
  original: z.string(),
  normalized: z.string(),
});

const routingSchema = z.object({
  primaryAgent: primaryAgentSchema,
  candidateAgents: z.array(primaryAgentSchema).optional(),
  reason: z.string().trim().min(1).optional(),
});

const inputImageSchema = z.object({
  id: z.string(),
  role: imageRoleSchema.optional(),
});

const inputFileSchema = z.object({
  id: z.string(),
  type: z.string(),
});

const inputsSchema = z.object({
  text: z.string(),
  images: z.array(inputImageSchema).optional(),
  files: z.array(inputFileSchema).optional(),
});

// constraint.value is string-encoded so the structured-output schema stays
// concrete and reliable (e.g. "4", "1080x1440", "3:4"). Sub-agents parse it.
const explicitConstraintSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
  sourceText: z.string(),
});

const inferredConstraintSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
  reason: z.string(),
});

const constraintsSchema = z.object({
  explicit: z.array(explicitConstraintSchema).optional(),
  inferred: z.array(inferredConstraintSchema).optional(),
});

const ambiguitySchema = z.object({
  issue: z.string().trim().min(1),
  options: z.array(z.string()).optional(),
  severity: ambiguitySeveritySchema,
});

const workflowStageSchema = z.object({
  id: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  action: taskActionSchema,
  agent: primaryAgentSchema,
  inputModalities: z.array(workflowModalitySchema).optional(),
  outputArtifacts: z.array(workflowArtifactSchema).optional(),
  dependsOn: z.array(z.string()).optional(),
});

const workflowSchema = z.object({
  mode: workflowModeSchema.optional(),
  inputModalities: z.array(workflowModalitySchema).optional(),
  outputArtifacts: z.array(workflowArtifactSchema).optional(),
  requiredAgents: z.array(primaryAgentSchema).optional(),
  requiredCapabilities: z.array(z.string().trim().min(1)).optional(),
  stages: z.array(workflowStageSchema).optional(),
});

export const normalizedAgentInputSchema = z.object({
  rawInput: z.string().optional(),
  task: taskSchema,
  userGoal: userGoalSchema,
  routing: routingSchema,
  inputs: inputsSchema,
  constraints: constraintsSchema.optional(),
  ambiguities: z.array(ambiguitySchema).optional(),
  workflow: workflowSchema.optional(),
});

export type NormalizedAgentInput = {
  rawInput: string;
  task: z.infer<typeof taskSchema>;
  userGoal: z.infer<typeof userGoalSchema>;
  routing: {
    primaryAgent: PrimaryAgent;
    candidateAgents: PrimaryAgent[];
    reason?: string;
  };
  inputs: {
    text: string;
    images: Array<z.infer<typeof inputImageSchema>>;
    files: Array<z.infer<typeof inputFileSchema>>;
  };
  constraints: {
    explicit: Array<z.infer<typeof explicitConstraintSchema>>;
    inferred: Array<z.infer<typeof inferredConstraintSchema>>;
  };
  ambiguities: Array<z.infer<typeof ambiguitySchema>>;
  workflow: {
    mode: WorkflowMode;
    inputModalities: WorkflowModality[];
    outputArtifacts: WorkflowArtifact[];
    requiredAgents: PrimaryAgent[];
    requiredCapabilities: string[];
    stages: WorkflowStage[];
  };
};

export type TaskDomain = z.infer<typeof taskDomainSchema>;
export type TaskAction = z.infer<typeof taskActionSchema>;
export type PrimaryAgent = z.infer<typeof primaryAgentSchema>;
export type ImageRole = z.infer<typeof imageRoleSchema>;
export type ExplicitConstraint = z.infer<typeof explicitConstraintSchema>;
export type InferredConstraint = z.infer<typeof inferredConstraintSchema>;
export type WorkflowMode = z.infer<typeof workflowModeSchema>;
export type WorkflowModality = z.infer<typeof workflowModalitySchema>;
export type WorkflowArtifact = z.infer<typeof workflowArtifactSchema>;
export type WorkflowStage = z.infer<typeof workflowStageSchema>;

type NormalizeInput = {
  message: string;
  selectedNodeId: string | null;
  upstreamContext: Array<{
    content?: string;
    contentFormat?: string;
    mimeType?: string;
    nodeId: string;
    type: string;
    prompt?: string;
    summary?: string;
    title?: string;
  }>;
};

type NormalizeAgentInputOptions = {
  maxOutputImages?: number;
  onCacheStatus?: (status: InputNormalizerCacheStatus) => void;
  signal?: AbortSignal;
};

export type InputNormalizerCacheStatus = {
  cacheHit: boolean;
  promptCharCount: number;
  upstreamContextCount: number;
};

let normalizerRunner: Runner | undefined;
let normalizerAgent: Agent<unknown, typeof normalizedAgentInputSchema> | undefined;

const inputNormalizerCacheVersion = "task-frame-light-context-v1";
const inputNormalizerCacheMaxEntries = 128;
const inputNormalizerCacheTtlMs = 10 * 60 * 1000;
const normalizerContextLimit = 12;
const normalizerTitleCharLimit = 160;
const normalizerSummaryCharLimit = 600;
const normalizerPromptCharLimit = 600;

const inputNormalizerCache = new Map<
  string,
  { expiresAt: number; value: NormalizedAgentInput }
>();

export async function normalizeAgentInput(
  input: NormalizeInput,
  options: NormalizeAgentInputOptions = {}
): Promise<NormalizedAgentInput> {
  assertNotAborted(options.signal);
  const prompt = buildNormalizerPrompt(input, options.maxOutputImages);
  const cacheKey = buildInputNormalizerCacheKey(input, options.maxOutputImages);
  const cached = readInputNormalizerCache(cacheKey);
  if (cached) {
    options.onCacheStatus?.({
      cacheHit: true,
      promptCharCount: prompt.length,
      upstreamContextCount: Math.min(input.upstreamContext.length, normalizerContextLimit),
    });
    return cloneNormalizedAgentInput(cached);
  }

  options.onCacheStatus?.({
    cacheHit: false,
    promptCharCount: prompt.length,
    upstreamContextCount: Math.min(input.upstreamContext.length, normalizerContextLimit),
  });

  const agent = createInputNormalizerAgent();
  const result = await getNormalizerRunner().run(
    agent,
    prompt,
    {
      maxTurns: 1,
      signal: options.signal,
    }
  );
  if (!result.finalOutput) {
    throw new Error("Input normalization did not produce a structured result.");
  }

  const normalized = finalizeNormalizedAgentInput(result.finalOutput, input.message);
  writeInputNormalizerCache(cacheKey, normalized);
  return cloneNormalizedAgentInput(normalized);
}

export function createInputNormalizerAgent() {
  normalizerAgent ??= new Agent({
    name: "Cucumber Input Normalizer",
    instructions: [
      "You are the Cucumber Input Normalizer. Convert the user's request into a compact Task Frame for routing.",
      "Do not execute the task. Classify and route only. Never emit domain-specific tool parameters (no resultCount, dimensions, aspectRatio, prompt text, variants). Each sub-agent derives its own final parameters from constraints.",
      "Output shape: task{domain,intent,action,confidence}, userGoal{original,normalized}, routing{primaryAgent,candidateAgents,reason}, inputs{text,images,files}, constraints{explicit,inferred}, ambiguities, workflow{mode,inputModalities,outputArtifacts,requiredAgents,requiredCapabilities,stages}.",
      "task.domain is one of image, text, code, canvas, data, figma, mixed, web, unknown. Use mixed when no single domain owns the request.",
      "task.action is one of create, edit, analyze, transform, extract, upscale, unknown.",
      "task.intent is a short free-text label such as image.generate, image.matting, image.decompose, image.upscale, media.analyze, document.create, document.edit, webpage.create, web.fetch, research.answer, code.create, data.analyze, canvas.operation, prompt.edit, text.answer.",
      "task.confidence is 0..1 self-assessed classification confidence.",
      "routing.primaryAgent is one of image_agent, document_agent, web_agent, research_agent, manager_agent. routing.candidateAgents lists other plausible agents.",
      "Think of the user request as a task graph, not as a fixed bucket. Single-step requests may have workflow.mode=single and one primaryAgent. Hybrid or multi-step requests must use workflow.mode=hybrid or multi_step, routing.primaryAgent=manager_agent, and workflow.requiredAgents/candidateAgents/stages to name every specialist that may be needed.",
      "workflow.inputModalities is one or more of text, image, code, document, webpage, data, canvas, figma, unknown. workflow.outputArtifacts is one or more of answer, image, doc, markdown, diagram, code, webpage, dataset, canvas_operation, research, decision, tool_result, file, memory, unknown.",
      "workflow.requiredCapabilities should name semantic capabilities such as media-analysis, image-generation, markdown-artifact, code-artifact, web-fetch, research, canvas-operation. Keep names short and reusable.",
      "workflow.stages is an ordered high-level plan only. Each stage has id, goal, action, agent, inputModalities, outputArtifacts, dependsOn. Do not include tool arguments, URLs fabricated from context, or final content.",
      "Route image generation, outpainting/canvas expansion, matting/background removal, image decomposition, media understanding, and upscaling to image_agent.",
      "Route markdown, documents, diagrams (sequence/flowchart -> mermaid), HTML/H5/webpage demos, code drafts, PRDs, briefs, summaries, and reusable text templates to document_agent.",
      "Route single public webpage fetch/read/summarize to web_agent. Route web-search-backed cited research/comparison to research_agent.",
      "Route plain answers, smalltalk, prompt/text edits, image-metadata questions, canvas node/shape operations, and anything ambiguous to manager_agent.",
      "If the request combines analysis and generation, or asks for image + text + code, or names a multi-step workflow, do not force it into the final artifact's bucket. Mark workflow.mode=hybrid or multi_step, make manager_agent primary, and list the involved specialists.",
      "The words visual, 视觉, H5, campaign, product, marketing usually describe domain or context. They do not by themselves make the task image generation.",
      "Questions asking which tools, models, providers, APIs, SDKs, platforms, or open-source/free resources exist are plain answers: domain=text, action=analyze, intent=text.answer, primaryAgent=manager_agent. The phrase 图片生成工具 / image generation API is the subject being asked about, not a request to generate an image.",
      "Questions asking why/how image generation works, fails, costs, or which model/provider/seed/size an existing image used are answers (domain=text or image, action=analyze, intent=text.answer or media.analyze), never image creation.",
      "Requests to edit, rewrite, polish, expand, shorten, or remove parts of a prompt/text/description are domain=text, action=edit, intent=prompt.edit, primaryAgent=manager_agent. Terse commands such as 取消标题 / 去掉标题 revise the selected text and must not generate images unless the user explicitly asks to generate a new image now.",
      "Requests to analyze/critique/evaluate a visual brief or image are action=analyze with no image creation unless the user explicitly asks to render an image now.",
      "Infer image creation only when the request has both an image artifact target and a create/render action, or when explicit image-composer mode is active.",
      "constraints.explicit: extract user-stated hard constraints verbatim from the request, each as {key, value, sourceText}. Use string-encoded values. Examples: count '4 张' -> {key:'output_count', value:'4', sourceText:'4 张'}; size '1080x1440' -> {key:'dimension', value:'1080x1440', sourceText:'1080x1440'}; ratio '16:9' -> {key:'aspect_ratio', value:'16:9', sourceText:'16:9'}; style/format/language/tone constraints likewise. Do not invent constraints the user did not state.",
      "constraints.inferred: optional soft defaults you suggest, each as {key, value, reason}. Keep these minimal; sub-agents make final calls.",
      "inputs.text is the cleaned user instruction. inputs.images and inputs.files are best-effort role hints only; the runtime owns trusted image references, so never rely on these ids for resolution and never fabricate image URLs.",
      "ambiguities: list genuine unresolved choices with options and severity. Leave empty when the request is clear.",
      "userGoal.original is the raw request; userGoal.normalized is a one-line restatement of the goal.",
    ].join("\n"),
    outputType: normalizedAgentInputSchema,
  });
  return normalizerAgent;
}

export function prewarmInputNormalizer() {
  getNormalizerRunner();
  createInputNormalizerAgent();
}

function getNormalizerRunner() {
  normalizerRunner ??= new Runner({
    workflowName: "Cucumber Input Normalizer",
    ...getInputNormalizerRunnerConfig(),
  });
  return normalizerRunner;
}

// Zero-fallback finalize: validate the model output and normalize text only.
// No rule-based intent/artifact correction. The Task Frame is what the model said.
export function finalizeNormalizedAgentInput(
  candidate: unknown,
  rawInput: string
): NormalizedAgentInput {
  const parsed = normalizedAgentInputSchema.parse(candidate);
  const raw = normalizeText(rawInput);

  return {
    rawInput: raw,
    task: {
      domain: parsed.task.domain,
      intent: normalizeText(parsed.task.intent) || parsed.task.intent,
      action: parsed.task.action,
      confidence: parsed.task.confidence,
    },
    userGoal: {
      original: normalizeNullableText(parsed.userGoal.original) ?? raw,
      normalized: normalizeNullableText(parsed.userGoal.normalized) ?? raw,
    },
    routing: {
      primaryAgent: parsed.routing.primaryAgent,
      candidateAgents: uniqueAgents(parsed.routing.candidateAgents ?? []),
      reason: normalizeNullableText(parsed.routing.reason) ?? undefined,
    },
    inputs: {
      text: normalizeNullableText(parsed.inputs.text) ?? raw,
      images: parsed.inputs.images ?? [],
      files: parsed.inputs.files ?? [],
    },
    constraints: {
      explicit: parsed.constraints?.explicit ?? [],
      inferred: parsed.constraints?.inferred ?? [],
    },
    ambiguities: (parsed.ambiguities ?? []).map((ambiguity) => ({
      issue: ambiguity.issue,
      options: ambiguity.options ?? [],
      severity: ambiguity.severity,
    })),
    workflow: normalizeWorkflow(parsed.workflow),
  };
}

export function getExplicitConstraint(
  input: NormalizedAgentInput | null | undefined,
  key: string
): string | undefined {
  return input?.constraints.explicit.find((entry) => entry.key === key)?.value;
}

export function getExplicitConstraints(
  input: NormalizedAgentInput | null | undefined,
  key: string
): string[] {
  return (input?.constraints.explicit ?? [])
    .filter((entry) => entry.key === key)
    .map((entry) => entry.value);
}

export function buildNormalizerPrompt(
  input: NormalizeInput,
  maxOutputImages?: number
) {
  const upstreamSummary = buildLightNormalizerContext(input.upstreamContext);

  return [
    `User request: ${input.message}`,
    `Selected node id: ${input.selectedNodeId ?? "none"}`,
    maxOutputImages ? `Max image result count: ${maxOutputImages}` : "",
    `Trusted upstream context summary: ${JSON.stringify(upstreamSummary)}`,
  ].filter(Boolean).join("\n\n");
}

export function clearInputNormalizerCacheForTests() {
  inputNormalizerCache.clear();
}

export function buildInputNormalizerCacheKeyForTests(
  input: NormalizeInput,
  maxOutputImages?: number
) {
  return buildInputNormalizerCacheKey(input, maxOutputImages);
}

function buildLightNormalizerContext(input: NormalizeInput["upstreamContext"]) {
  return input
    .slice(0, normalizerContextLimit)
    .map(({ content, contentFormat, mimeType, nodeId, prompt, summary, title, type }) => ({
      contentAvailable: Boolean(content),
      contentFormat,
      mimeType,
      nodeId,
      prompt: limitText(prompt, normalizerPromptCharLimit),
      summary: limitText(summary, normalizerSummaryCharLimit),
      title: limitText(title, normalizerTitleCharLimit),
      type,
    }));
}

function buildInputNormalizerCacheKey(
  input: NormalizeInput,
  maxOutputImages?: number
) {
  return JSON.stringify({
    context: buildLightNormalizerContext(input.upstreamContext),
    maxOutputImages: maxOutputImages ?? null,
    message: input.message,
    selectedNodeId: input.selectedNodeId,
    version: inputNormalizerCacheVersion,
  });
}

function readInputNormalizerCache(key: string) {
  const entry = inputNormalizerCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    inputNormalizerCache.delete(key);
    return null;
  }
  inputNormalizerCache.delete(key);
  inputNormalizerCache.set(key, entry);
  return cloneNormalizedAgentInput(entry.value);
}

function writeInputNormalizerCache(key: string, value: NormalizedAgentInput) {
  inputNormalizerCache.set(key, {
    expiresAt: Date.now() + inputNormalizerCacheTtlMs,
    value: cloneNormalizedAgentInput(value),
  });

  while (inputNormalizerCache.size > inputNormalizerCacheMaxEntries) {
    const oldestKey = inputNormalizerCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    inputNormalizerCache.delete(oldestKey);
  }
}

function cloneNormalizedAgentInput(input: NormalizedAgentInput): NormalizedAgentInput {
  return {
    rawInput: input.rawInput,
    task: { ...input.task },
    userGoal: { ...input.userGoal },
    routing: {
      ...input.routing,
      candidateAgents: [...input.routing.candidateAgents],
    },
    inputs: {
      text: input.inputs.text,
      images: input.inputs.images.map((image) => ({ ...image })),
      files: input.inputs.files.map((file) => ({ ...file })),
    },
    constraints: {
      explicit: input.constraints.explicit.map((constraint) => ({ ...constraint })),
      inferred: input.constraints.inferred.map((constraint) => ({ ...constraint })),
    },
    ambiguities: input.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      options: [...(ambiguity.options ?? [])],
    })),
    workflow: {
      mode: input.workflow.mode,
      inputModalities: [...input.workflow.inputModalities],
      outputArtifacts: [...input.workflow.outputArtifacts],
      requiredAgents: [...input.workflow.requiredAgents],
      requiredCapabilities: [...input.workflow.requiredCapabilities],
      stages: input.workflow.stages.map((stage) => ({
        ...stage,
        dependsOn: [...(stage.dependsOn ?? [])],
        inputModalities: [...(stage.inputModalities ?? [])],
        outputArtifacts: [...(stage.outputArtifacts ?? [])],
      })),
    },
  };
}

function limitText(value: string | undefined, maxChars: number) {
  const normalized = value ? normalizeText(value) : "";
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...[truncated]`;
}

function assertNotAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

function uniqueAgents(agents: PrimaryAgent[]): PrimaryAgent[] {
  return [...new Set(agents)];
}

function normalizeWorkflow(
  workflow: z.infer<typeof workflowSchema> | undefined
): NormalizedAgentInput["workflow"] {
  return {
    mode: workflow?.mode ?? "single",
    inputModalities: uniqueValues(workflow?.inputModalities ?? []),
    outputArtifacts: uniqueValues(workflow?.outputArtifacts ?? []),
    requiredAgents: uniqueAgents(workflow?.requiredAgents ?? []),
    requiredCapabilities: uniqueStrings(workflow?.requiredCapabilities ?? []),
    stages: (workflow?.stages ?? []).map((stage) => ({
      id: stage.id,
      goal: stage.goal,
      action: stage.action,
      agent: stage.agent,
      inputModalities: uniqueValues(stage.inputModalities ?? []),
      outputArtifacts: uniqueValues(stage.outputArtifacts ?? []),
      dependsOn: uniqueStrings(stage.dependsOn ?? []),
    })),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function uniqueValues<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeText(value) || null;
}

export function normalizeText(value: string) {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .replace(/([\u4e00-\u9fff])([A-Za-z][A-Za-z0-9]*)/g, "$1 $2")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
