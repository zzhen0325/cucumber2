import { Agent, Runner } from "@openai/agents";
import { z } from "zod";

import { getAgentRunnerConfig } from "./model-config.ts";

export const taskOperationValues = [
  "create",
  "edit",
  "analyze",
  "answer",
  "transform",
] as const;

export const taskArtifactKindValues = [
  "image",
  "markdown",
  "document",
  "diagram",
  "code",
  "webpage",
  "data",
  "canvas",
] as const;

export const taskArtifactSubtypeValues = [
  "sequenceDiagram",
  "flowchart",
  "prd",
  "brief",
  "poster",
  "banner",
  "table",
  "mindmap",
] as const;

export const taskArtifactFormatValues = [
  "markdown",
  "mermaid",
  "html",
  "json",
  "png",
] as const;

export const taskDomainValues = [
  "visual-design",
  "product",
  "engineering",
  "marketing",
  "general",
] as const;

const taskOperationSchema = z.enum(taskOperationValues);
const taskArtifactKindSchema = z.enum(taskArtifactKindValues);
const taskArtifactSubtypeSchema = z.enum(taskArtifactSubtypeValues);
const taskArtifactFormatSchema = z.enum(taskArtifactFormatValues);
const taskDomainSchema = z.enum(taskDomainValues);

const normalizedIntentSchema = z.enum([
  "document.create",
  "document.edit",
  "web.fetch",
  "research.answer",
  "code.create",
  "data.analyze",
  "workflow.plan",
  "image.generate",
  "image.upscale",
  "text.answer",
  "canvas.operation",
  "unsupported",
]);

const normalizedDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const normalizedImageInputSchema = z.object({
  contentPrompt: z.string().trim().min(1).nullable().optional(),
  resultCount: z.number().int().positive().nullable().optional(),
  aspectRatio: z.string().trim().min(1).nullable().optional(),
  dimensions: normalizedDimensionsSchema.nullable().optional(),
  usage: z.string().trim().min(1).nullable().optional(),
  style: z.string().trim().min(1).nullable().optional(),
  subject: z.string().trim().min(1).nullable().optional(),
  scene: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

const normalizedArtifactSchema = z.object({
  kind: taskArtifactKindSchema,
  subtype: taskArtifactSubtypeSchema.nullable().optional(),
  format: taskArtifactFormatSchema.nullable().optional(),
});

export const normalizedAgentInputSchema = z.object({
  rawPrompt: z.string(),
  userGoal: z.string().trim().min(1).optional(),
  operation: taskOperationSchema.optional(),
  artifact: normalizedArtifactSchema.nullable().optional(),
  domain: taskDomainSchema.optional(),
  requiredCapabilities: z.array(z.string().trim().min(1)).optional(),
  negativeCapabilities: z.array(z.string().trim().min(1)).optional(),
  // Kept as a derived compatibility field for existing Trace/UI summaries.
  // Runtime routing must use operation/artifact/capability helpers instead.
  intent: normalizedIntentSchema.optional(),
  image: normalizedImageInputSchema.nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

export type NormalizedAgentInput = z.infer<typeof normalizedAgentInputSchema>;
export type NormalizedImageInput = z.infer<typeof normalizedImageInputSchema>;
export type NormalizedIntent = z.infer<typeof normalizedIntentSchema>;
export type TaskOperation = z.infer<typeof taskOperationSchema>;
export type TaskArtifactKind = z.infer<typeof taskArtifactKindSchema>;
export type TaskArtifactSubtype = z.infer<typeof taskArtifactSubtypeSchema>;
export type TaskArtifactFormat = z.infer<typeof taskArtifactFormatSchema>;
export type TaskDomain = z.infer<typeof taskDomainSchema>;

export type SpecialistRoute =
  | "document"
  | "image"
  | "manager"
  | "research"
  | "web";

type NormalizeInput = {
  message: string;
  selectedNodeId: string | null;
  upstreamContext: Array<{
    nodeId: string;
    type: string;
    prompt?: string;
    summary?: string;
    title?: string;
  }>;
};

type NormalizeAgentInputOptions = {
  maxOutputImages?: number;
  signal?: AbortSignal;
};

let normalizerRunner: Runner | undefined;

export async function normalizeAgentInput(
  input: NormalizeInput,
  options: NormalizeAgentInputOptions = {}
): Promise<NormalizedAgentInput> {
  const maxOutputImages = options.maxOutputImages ?? readMaxOutputImages();
  const agent = createInputNormalizerAgent();
  const result = await getNormalizerRunner().run(
    agent,
    buildNormalizerPrompt(input, maxOutputImages),
    {
      maxTurns: 1,
      signal: options.signal,
    }
  );
  if (!result.finalOutput) {
    throw new Error("Input normalization did not produce a structured result.");
  }

  return finalizeNormalizedAgentInput(result.finalOutput, input.message, {
    maxOutputImages,
  });
}

export function createInputNormalizerAgent() {
  return new Agent({
    name: "Cucumber Input Normalizer",
    instructions: [
      "Normalize the user's request into a compact artifact-first task object.",
      "Do not execute the task. Extract only fields that are stated or strongly implied.",
      "Required top-level shape: userGoal, operation, artifact, domain, requiredCapabilities, negativeCapabilities, image, notes.",
      "operation must be one of create, edit, analyze, answer, transform.",
      "artifact.kind must be one of image, markdown, document, diagram, code, webpage, data, canvas, or null when the task is a plain answer.",
      "Use artifact.subtype for specific product shape such as sequenceDiagram, flowchart, prd, brief, poster, banner, table, or mindmap.",
      "Use artifact.format for output encoding such as markdown, mermaid, html, json, or png.",
      "The words visual, 视觉, H5, campaign, product, marketing, engineering usually describe domain or context. They do not imply artifact.kind=image by themselves.",
      "Classify 流程时序图 / sequence diagram as operation=create, artifact.kind=diagram, artifact.subtype=sequenceDiagram, artifact.format=mermaid, requiredCapabilities including sequence-diagram and markdown-artifact, negativeCapabilities including image-generation.",
      "Classify 流程图 / flowchart as diagram/flowchart/mermaid unless the user asks for a poster or rendered image.",
      "Classify PRD, brief,方案,说明,邮件草稿,纪要 as document or markdown artifacts.",
      "Classify requests to edit, rewrite, polish, expand, shorten, remove parts from, or otherwise revise a prompt/text/description as operation=edit with artifact=null and negativeCapabilities including image-generation. Terse commands such as 取消标题, 去掉标题, 删除文案, or remove the title should revise the selected/upstream prompt text and must not generate images unless the user explicitly asks to generate/create/render an image now.",
      "Classify requests to analyze, evaluate, critique, summarize, or give suggestions for a visual/image/banner/poster/KV brief as operation=analyze or answer with no image artifact unless the user explicitly asks to generate/create/render the image now; include negativeCapabilities image-generation.",
      "Classify explicit long-form output requests such as detailed explanation, complete plan, roadmap, proposal, research analysis, report, 文档, 详细说明, 完整规划, 调研分析, or 长文 as operation=create or analyze with artifact.kind=document or markdown. Short QA remains artifact=null.",
      "Classify image creation as artifact.kind=image with png format, and image upscaling/enhancement of an existing image as operation=transform, artifact.kind=image.",
      "For image artifacts, separate visual content from production controls such as count, aspect ratio, pixel dimensions, and usage.",
      "contentPrompt must be a clean renderable image description. Remove batch-count phrases such as four images, 四张, 一组4张.",
      "Keep reference image URLs out of the output. Canvas image references are handled by runtime, not by the model.",
      "Default image resultCount to 1 when the user does not request a count.",
      "Do not rely on legacy intent. If you include it, it must be consistent with operation/artifact and is only a compatibility summary.",
    ].join("\n"),
    outputType: normalizedAgentInputSchema,
  });
}

function getNormalizerRunner() {
  normalizerRunner ??= new Runner({
    workflowName: "Cucumber Input Normalizer",
    ...getAgentRunnerConfig(),
  });
  return normalizerRunner;
}

export function finalizeNormalizedAgentInput(
  candidate: unknown,
  rawPrompt: string,
  options: { maxOutputImages?: number } = {}
): NormalizedAgentInput {
  const maxOutputImages = options.maxOutputImages ?? readMaxOutputImages();
  const parsed = normalizedAgentInputSchema.parse(candidate);
  const raw = normalizeText(rawPrompt);
  const ruleBased = inferTaskProtocol(raw);
  const promptTextEdit = isPromptTextEditRequest(raw);
  const artifact = promptTextEdit
    ? null
    : normalizeArtifact(raw, parsed.artifact ?? ruleBased.artifact);
  const operation = normalizeOperation(
    raw,
    promptTextEdit ? "edit" : parsed.operation ?? ruleBased.operation ?? "answer",
    artifact
  );
  const domain = parsed.domain ?? ruleBased.domain;
  const requiredCapabilities = uniqueCapabilityList([
    ...(ruleBased.requiredCapabilities ?? []),
    ...(parsed.requiredCapabilities ?? []),
  ]).filter((capability) => !promptTextEdit || !isImageTaskCapability(capability));
  const negativeCapabilities = uniqueCapabilityList([
    ...(ruleBased.negativeCapabilities ?? []),
    ...(parsed.negativeCapabilities ?? []),
    ...(promptTextEdit ? ["image-generation"] : []),
  ]);
  const intent = inferIntentFromProtocol({
    artifact,
    operation,
    rawPrompt: raw,
  });
  const base: Omit<NormalizedAgentInput, "image"> = {
    rawPrompt: raw,
    userGoal: normalizeNullableText(parsed.userGoal) ?? raw,
    operation,
    artifact,
    domain,
    requiredCapabilities,
    negativeCapabilities,
    intent,
    notes: normalizeNullableText(parsed.notes) ?? undefined,
  };

  if (!isImageArtifact(artifact)) {
    return {
      ...base,
    };
  }

  const image = normalizeImageRequestSlots(raw, parsed.image ?? undefined, {
    maxOutputImages,
  });

  return {
    ...base,
    image,
  };
}

export function normalizeImageRequestSlots(
  rawPrompt: string,
  candidate: NormalizedImageInput | null | undefined = undefined,
  options: { maxOutputImages?: number } = {}
): NormalizedImageInput {
  const maxOutputImages = options.maxOutputImages ?? readMaxOutputImages();
  const raw = normalizeText(rawPrompt);
  const resultCount = candidate?.resultCount ?? inferImageResultCount(raw) ?? 1;
  if (resultCount > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const dimensions = candidate?.dimensions ?? findExplicitDimensions(raw) ?? undefined;
  const aspectRatio =
    normalizeAspectRatio(candidate?.aspectRatio) ??
    (dimensions ? simplifyAspectRatio(dimensions.width, dimensions.height) : undefined) ??
    findExplicitAspectRatio(raw) ??
    undefined;
  const contentPrompt =
    normalizeContentPrompt(candidate?.contentPrompt ?? raw) ||
    normalizeContentPrompt(raw);

  if (!contentPrompt) {
    throw new Error("Input normalization did not produce an image content prompt.");
  }

  return {
    contentPrompt,
    resultCount,
    aspectRatio,
    dimensions,
    usage: normalizeNullableText(candidate?.usage) ?? inferUsage(raw) ?? undefined,
    style: normalizeNullableText(candidate?.style) ?? undefined,
    subject: normalizeNullableText(candidate?.subject) ?? undefined,
    scene: normalizeNullableText(candidate?.scene) ?? undefined,
    notes: normalizeNullableText(candidate?.notes) ?? undefined,
  };
}

function buildNormalizerPrompt(input: NormalizeInput, maxOutputImages: number) {
  const upstreamSummary = input.upstreamContext
    .map(({ nodeId, prompt, summary, title, type }) => ({
      nodeId,
      prompt,
      summary,
      title,
      type,
    }))
    .slice(0, 12);

  return [
    `User request: ${input.message}`,
    `Selected node id: ${input.selectedNodeId ?? "none"}`,
    `Max image result count: ${maxOutputImages}`,
    `Trusted upstream context summary: ${JSON.stringify(upstreamSummary)}`,
  ].join("\n\n");
}

export function isImageArtifactTask(input?: NormalizedAgentInput | null) {
  return isImageArtifact(input?.artifact ?? null);
}

export function isDocumentArtifactTask(input?: NormalizedAgentInput | null) {
  const artifact = input?.artifact;
  return Boolean(
    artifact &&
      ["diagram", "document", "markdown"].includes(artifact.kind)
  );
}

export function isWebArtifactTask(input?: NormalizedAgentInput | null) {
  return input?.artifact?.kind === "webpage";
}

export function isResearchAnswerTask(input?: NormalizedAgentInput | null) {
  const capabilities = new Set(input?.requiredCapabilities ?? []);
  return (
    input?.operation === "answer" &&
    (capabilities.has("source-based-answer") ||
      capabilities.has("citations") ||
      capabilities.has("research"))
  );
}

export function hasNegativeCapability(
  input: NormalizedAgentInput | null | undefined,
  capability: string
) {
  return (input?.negativeCapabilities ?? []).includes(capability);
}

export function selectAgentRoute(
  input?: NormalizedAgentInput | null
): SpecialistRoute {
  const routes = selectAgentRoutesForTask(input);
  return routes.length === 1 ? routes[0] : "manager";
}

export function selectAgentRoutesForTask(
  input?: NormalizedAgentInput | null
): Exclude<SpecialistRoute, "manager">[] {
  if (!input) {
    return [];
  }
  const routes: Exclude<SpecialistRoute, "manager">[] = [];
  if (isImageArtifactTask(input)) {
    routes.push("image");
    return routes;
  }
  if (
    (input.requiredCapabilities ?? []).some((capability) =>
      ["research", "source-based-answer", "web-fetch"].includes(capability)
    ) &&
    isDocumentArtifactTask(input)
  ) {
    if ((input.requiredCapabilities ?? []).includes("web-fetch")) {
      routes.push("web");
    }
    if (
      (input.requiredCapabilities ?? []).some((capability) =>
        ["research", "source-based-answer", "citations"].includes(capability)
      )
    ) {
      routes.push("research");
    }
    routes.push("document");
    return routes;
  }
  if (isDocumentArtifactTask(input)) {
    routes.push("document");
    return routes;
  }
  if (isWebArtifactTask(input)) {
    routes.push("web");
    return routes;
  }
  if (isResearchAnswerTask(input)) {
    routes.push("research");
    return routes;
  }
  return routes;
}

export function inferIntentFromProtocol({
  artifact,
  operation,
  rawPrompt,
}: {
  artifact?: NormalizedAgentInput["artifact"];
  operation: TaskOperation;
  rawPrompt: string;
}): NormalizedIntent {
  if (isImageArtifact(artifact)) {
    return operation === "transform" ? "image.upscale" : "image.generate";
  }
  if (artifact?.kind === "webpage") {
    return "web.fetch";
  }
  if (artifact?.kind === "diagram" || artifact?.kind === "document" || artifact?.kind === "markdown") {
    return operation === "edit" ? "document.edit" : "document.create";
  }
  if (artifact?.kind === "code") {
    return "code.create";
  }
  if (artifact?.kind === "data") {
    return "data.analyze";
  }
  if (artifact?.kind === "canvas") {
    return "canvas.operation";
  }
  if (/(调研|研究|搜索|查找资料|引用来源|research|sources?|citations?)/i.test(rawPrompt)) {
    return "research.answer";
  }
  if (/(计划|拆解任务|workflow|checkpoint|plan)/i.test(rawPrompt)) {
    return "workflow.plan";
  }
  return "text.answer";
}

function inferTaskProtocol(prompt: string): Pick<
  NormalizedAgentInput,
  | "artifact"
  | "domain"
  | "negativeCapabilities"
  | "operation"
  | "requiredCapabilities"
> {
  const domain = inferDomain(prompt);

  if (isPromptTextEditRequest(prompt)) {
    return {
      artifact: null,
      domain,
      negativeCapabilities: ["image-generation"],
      operation: "edit",
      requiredCapabilities: [],
    };
  }

  if (isVisualBriefAnalysisRequest(prompt)) {
    return {
      artifact: null,
      domain,
      negativeCapabilities: ["image-generation"],
      operation: "analyze",
      requiredCapabilities: [],
    };
  }

  if (/(流程\s*时序图|时序图|sequence\s*diagram)/i.test(prompt)) {
    return {
      artifact: {
        kind: "diagram",
        subtype: "sequenceDiagram",
        format: "mermaid",
      },
      domain,
      negativeCapabilities: ["image-generation"],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: ["sequence-diagram", "markdown-artifact"],
    };
  }

  if (/(流程图|flowchart|流程\s*图)/i.test(prompt) && !hasExplicitImageCreationRequest(prompt)) {
    return {
      artifact: {
        kind: "diagram",
        subtype: "flowchart",
        format: "mermaid",
      },
      domain,
      negativeCapabilities: ["image-generation"],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: ["flowchart", "markdown-artifact"],
    };
  }

  if (
    /(PRD|产品需求文档|需求文档)/i.test(prompt)
  ) {
    return {
      artifact: {
        kind: "document",
        subtype: "prd",
        format: "markdown",
      },
      domain: "product",
      negativeCapabilities: [],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: ["markdown-artifact"],
    };
  }

  if (/(抓取|读取|总结|概括|整理).*(网页|页面|网址|链接|URL)|(网页|页面).*(总结|概括|整理|文档)|\b(fetch|read|summarize)\b.*\b(webpage|page|url|link)\b/i.test(prompt)) {
    return {
      artifact: {
        kind: /(总结|summarize|整理|概括).*(文档|document|markdown|md)|文档/i.test(prompt)
          ? "document"
          : "webpage",
        format: /(总结|summarize|整理|概括).*(文档|document|markdown|md)|文档/i.test(prompt)
          ? "markdown"
          : "html",
      },
      domain,
      negativeCapabilities: [],
      operation: /(总结|summarize|整理|概括)/i.test(prompt) ? "transform" : "create",
      requiredCapabilities: [
        "web-fetch",
        ...(/(文档|document|markdown|md)/i.test(prompt) ? ["markdown-artifact"] : []),
      ],
    };
  }

  if (isLongFormDocumentRequest(prompt)) {
    return {
      artifact: {
        kind: /markdown|md/i.test(prompt) ? "markdown" : "document",
        subtype: inferLongFormDocumentSubtype(prompt),
        format: "markdown",
      },
      domain,
      negativeCapabilities: ["image-generation"],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: inferLongFormDocumentCapabilities(prompt),
    };
  }

  if (/(brief|方案|说明|邮件|纪要|提纲|大纲|稿|文档|markdown|md)/i.test(prompt)) {
    return {
      artifact: {
        kind: /markdown|md/i.test(prompt) ? "markdown" : "document",
        subtype: /(brief|方案)/i.test(prompt) ? "brief" : undefined,
        format: "markdown",
      },
      domain,
      negativeCapabilities: [],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: ["markdown-artifact"],
    };
  }

  if (/(放大|高清|超清|提升清晰|upscale|enhance)/i.test(prompt)) {
    return {
      artifact: { kind: "image", format: "png" },
      domain,
      negativeCapabilities: [],
      operation: "transform",
      requiredCapabilities: ["image-upscale"],
    };
  }

  if (
    hasExplicitImageCreationRequest(prompt) ||
    /(生成|创建|画|出图|图片|图像|插画|海报|banner|kv|photo|image|illustration|poster)/i.test(
      prompt
    )
  ) {
    return {
      artifact: {
        kind: "image",
        subtype: inferImageSubtype(prompt),
        format: "png",
      },
      domain,
      negativeCapabilities: [],
      operation: "create",
      requiredCapabilities: ["image-generation"],
    };
  }

  if (/(代码|函数|组件|脚本|diff|patch|code|function|component|script)/i.test(prompt)) {
    return {
      artifact: { kind: "code", format: "markdown" },
      domain: "engineering",
      negativeCapabilities: [],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: [],
    };
  }

  if (/(csv|表格|数据|JSON|分析数据|dataset|spreadsheet|analy[sz]e data)/i.test(prompt)) {
    return {
      artifact: {
        kind: "data",
        subtype: /表格|table|spreadsheet/i.test(prompt) ? "table" : undefined,
        format: /json/i.test(prompt) ? "json" : undefined,
      },
      domain,
      negativeCapabilities: [],
      operation: /分析|analy[sz]e/i.test(prompt) ? "analyze" : "create",
      requiredCapabilities: [],
    };
  }

  if (/(便签|形状|节点|画布)/.test(prompt)) {
    return {
      artifact: { kind: "canvas" },
      domain,
      negativeCapabilities: [],
      operation: "edit",
      requiredCapabilities: ["canvas-operation"],
    };
  }

  return {
    artifact: null,
    domain,
    negativeCapabilities: [],
    operation: "answer",
    requiredCapabilities: [],
  };
}

function normalizeArtifact(
  rawPrompt: string,
  artifact: NormalizedAgentInput["artifact"] | null | undefined
): NormalizedAgentInput["artifact"] {
  const inferred = inferTaskProtocol(rawPrompt).artifact;
  if (!artifact) {
    return inferred ?? null;
  }
  if (isVisualBriefAnalysisRequest(rawPrompt) && artifact.kind === "image") {
    return null;
  }
  if (/(流程\s*时序图|时序图|sequence\s*diagram)/i.test(rawPrompt)) {
    return { kind: "diagram", subtype: "sequenceDiagram", format: "mermaid" };
  }
  if (/(流程图|flowchart|流程\s*图)/i.test(rawPrompt) && artifact.kind !== "image") {
    return { kind: "diagram", subtype: "flowchart", format: "mermaid" };
  }
  return {
    kind: artifact.kind,
    subtype: artifact.subtype ?? inferred?.subtype ?? undefined,
    format: artifact.format ?? inferred?.format ?? undefined,
  };
}

function normalizeOperation(
  rawPrompt: string,
  operation: TaskOperation,
  artifact: NormalizedAgentInput["artifact"] | null | undefined
): TaskOperation {
  if (isPromptTextEditRequest(rawPrompt)) {
    return "edit";
  }
  if (isVisualBriefAnalysisRequest(rawPrompt)) {
    return "analyze";
  }
  if (isImageArtifact(artifact) && /(放大|高清|超清|提升清晰|upscale|enhance)/i.test(rawPrompt)) {
    return "transform";
  }
  if (isDocumentArtifactKind(artifact) && operation === "answer") {
    return "create";
  }
  return operation;
}

function isImageArtifact(
  artifact: NormalizedAgentInput["artifact"] | null | undefined
): artifact is NonNullable<NormalizedAgentInput["artifact"]> & { kind: "image" } {
  return artifact?.kind === "image";
}

function isDocumentArtifactKind(
  artifact: NormalizedAgentInput["artifact"] | null | undefined
) {
  return Boolean(
    artifact &&
      ["diagram", "document", "markdown"].includes(artifact.kind)
  );
}

function inferDomain(prompt: string): TaskDomain {
  if (/(视觉|H5|海报|banner|KV|主视觉|画面|构图|风格|色彩|poster|visual)/i.test(prompt)) {
    return "visual-design";
  }
  if (/(PRD|产品|需求|用户|roadmap|feature)/i.test(prompt)) {
    return "product";
  }
  if (/(代码|函数|组件|架构|技术|engineering|code|api|database)/i.test(prompt)) {
    return "engineering";
  }
  if (/(营销|campaign|增长|投放|广告|marketing)/i.test(prompt)) {
    return "marketing";
  }
  return "general";
}

function inferEditOperation(prompt: string) {
  return /(改写|润色|重写|编辑|更新|修改|rewrite|edit|update|revise)/i.test(prompt);
}

function isLongFormDocumentRequest(prompt: string) {
  if (hasExplicitImageCreationRequest(prompt)) {
    return false;
  }

  const explicitLongForm =
    /(长文|长篇|详细说明|详细解释|完整说明|完整规划|深度分析|深入分析|全面分析|调研分析|研究分析|调研报告|研究报告|分析报告|规划方案|执行计划|路线图|roadmap|whitepaper|report|write-?up)/i;
  if (explicitLongForm.test(prompt)) {
    return true;
  }
  if (/(给我|帮我|做|制定|输出|生成|创建|写|整理).{0,20}(规划|计划|roadmap|路线图)/i.test(prompt)) {
    return true;
  }

  const longFormCue =
    /(详细|完整|系统|深入|深度|全面|展开|一份|一篇|报告|文档|markdown|md|撰写|写|生成|创建|输出|整理成)/i;
  const longFormTarget =
    /(说明|解释|讲解|规划|计划|方案|调研|研究|分析|总结|复盘|对比|proposal|plan|report|brief)/i;

  return longFormCue.test(prompt) && longFormTarget.test(prompt);
}

function inferLongFormDocumentSubtype(
  prompt: string
): TaskArtifactSubtype | undefined {
  if (/(brief|方案|规划|计划|roadmap|路线图|proposal)/i.test(prompt)) {
    return "brief";
  }
  return undefined;
}

function inferLongFormDocumentCapabilities(prompt: string) {
  return uniqueCapabilityList([
    "markdown-artifact",
    ...(/https?:\/\//i.test(prompt) ? ["web-fetch"] : []),
    ...(/引用|来源|出处|citation|citations|sources?/i.test(prompt)
      ? ["source-based-answer", "citations"]
      : []),
  ]);
}

function isImageTaskCapability(capability: string) {
  return /image|图片|图像|upscale|视觉风格|prompt[-_ ]?expansion/i.test(capability);
}

export function isPromptTextEditRequest(prompt: string) {
  if (
    hasExplicitImageCreationRequest(prompt) ||
    /(放大|高清|超清|提升清晰|upscale|enhance)/i.test(prompt)
  ) {
    return false;
  }

  const editVerb =
    /(修改|改写|润色|重写|编辑|更新|调整|优化|扩写|精简|缩短|删除|去掉|移除|取消|不要|替换|保留|rewrite|revise|edit|polish|optimi[sz]e|expand|shorten|remove|delete|drop|without)/i;
  const promptTarget =
    /(提示词|prompt|指令|文本|文案|描述|这段|上面这段|当前内容|原文|description|copy|text)/i;

  if (
    new RegExp(`${editVerb.source}.{0,32}${promptTarget.source}`, "i").test(prompt) ||
    new RegExp(`${promptTarget.source}.{0,32}${editVerb.source}`, "i").test(prompt)
  ) {
    return true;
  }

  return /^(?:把|请|帮我|麻烦)?\s*(?:取消|去掉|删除|移除|不要|隐藏|删掉|remove|delete|drop)\s*(?:所有|全部|主|大)?\s*(?:标题|副标题|字幕|文案|文字|title|headline|caption)s?\s*$/i.test(
    prompt
  );
}

function inferImageSubtype(prompt: string): TaskArtifactSubtype | undefined {
  if (/(海报|poster)/i.test(prompt)) {
    return "poster";
  }
  if (/(banner|KV|主视觉|key visual)/i.test(prompt)) {
    return "banner";
  }
  return undefined;
}

function uniqueCapabilityList(values: string[]) {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

function isVisualBriefAnalysisRequest(prompt: string) {
  if (isLongFormDocumentRequest(prompt)) {
    return false;
  }

  const asksForAnalysis =
    /(分析|评估|评价|判断|拆解|解读|梳理|诊断|优化建议|给(?:我)?(?:一些)?建议|review|analy[sz]e|critique|evaluate|assess)/i.test(
      prompt
    );
  if (!asksForAnalysis) {
    return false;
  }

  const aboutVisualBrief =
    /(需求|主题|brief|方案|方向|画面|视觉|图片|图像|照片|这张图|此图|海报|banner|kv|主视觉|构图|背景|字体|元素|风格|色彩|氛围)/i.test(
      prompt
    );
  if (!aboutVisualBrief) {
    return false;
  }

  return !hasExplicitImageCreationRequest(prompt);
}

function hasExplicitImageCreationRequest(prompt: string) {
  return /((生成|创建|画|出图|渲染|产出|输出|制作).{0,16}(图片|图像|图|海报|banner|kv|主视觉)|(图片|图像|海报|banner|kv|主视觉).{0,16}(生成|创建|渲染|产出|输出|制作)|\b(generate|create|render|make)\b.{0,48}\b(image|poster|banner|key visual)\b)/i.test(
    prompt
  );
}

function inferImageResultCount(prompt: string) {
  const groupedArabicMatch = prompt.match(
    /(?:一|1)\s*组\s*(\d{1,2})\s*(?:张|幅|个|款|版|images?|imgs?|pictures?|results?)/i
  );
  if (groupedArabicMatch) {
    return Number(groupedArabicMatch[1]);
  }

  const groupedChineseMatch = prompt.match(
    /(?:一|1)\s*组\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|图片|图|结果)/
  );
  if (groupedChineseMatch) {
    return chineseImageCountToNumber(groupedChineseMatch[1]);
  }

  const arabicMatch = prompt.match(
    /(?:生成|出|要|做|给我|create|generate|make)?\s*(\d{1,2})\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)/i
  );
  if (arabicMatch) {
    return Number(arabicMatch[1]);
  }

  const chineseMatch = prompt.match(
    /(?:生成|出|要|做|给我)?\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|图片|图|结果)/
  );
  if (chineseMatch) {
    return chineseImageCountToNumber(chineseMatch[1]);
  }

  return null;
}

function normalizeContentPrompt(prompt: string) {
  return normalizeText(prompt)
    .replace(/\b\d{1,2}\s*[:：]\s*\d{1,2}\b/g, " ")
    .replace(/\b\d{3,5}\s*(?:x|×|\*)\s*\d{3,5}\b/gi, " ")
    .replace(
      /(?:一次\s*)?(?:生成|出|要|做|给我|create|generate|make)?\s*(?:一|1)\s*组\s*(?:\d{1,2}|[一二两三四五六七八九十])\s*(?:张|幅|个|款|版|images?|imgs?|pictures?|results?)(?:\s*(?:图片|图像|图|照片))?\s*(?:of\s+)?/gi,
      " "
    )
    .replace(
      /(?:一次\s*)?(?:生成|出|要|做|给我|create|generate|make)?\s*(?:\d{1,2}|[一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)(?:\s*(?:图片|图像|图|照片))?\s*(?:of\s+)?/gi,
      " "
    )
    .replace(/^\s*(?:生成|创建|帮我|请|做|画|出|给我)\s*/i, "")
    .replace(/^\s*(?:的|of)\s*/i, "")
    .replace(/\s+(?:的|of)$/i, "")
    .replace(/^[\s,，:：;；.。-]+/, "")
    .replace(/[\s,，:：;；.。-]+$/, "")
    .replace(/,/g, "，")
    .replace(/\b((?:banner\s+)?KV|banner)\s+(主体)/i, "$1，$2")
    .replace(/，+/g, "，")
    .replace(/\s+/g, " ")
    .trim();
}

function findExplicitDimensions(prompt: string) {
  const dimensionMatch = prompt.match(
    /\b(\d{3,5})\s*(?:x|×|\*)\s*(\d{3,5})\b/i
  );
  if (!dimensionMatch) {
    return null;
  }
  return {
    width: Number(dimensionMatch[1]),
    height: Number(dimensionMatch[2]),
  };
}

function findExplicitAspectRatio(prompt: string) {
  const ratioMatch = prompt.match(/\b(\d{1,2})\s*[:：]\s*(\d{1,2})\b/);
  if (ratioMatch) {
    return `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}`;
  }
  if (/(横版|横图|宽屏|landscape|wide)/i.test(prompt)) {
    return "16:9";
  }
  if (/(竖版|竖图|纵向|portrait|vertical)/i.test(prompt)) {
    return "9:16";
  }
  if (/(方图|方形|正方形|square)/i.test(prompt)) {
    return "1:1";
  }
  return null;
}

function normalizeAspectRatio(value: string | null | undefined) {
  const match = normalizeNullableText(value)?.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!match) {
    return null;
  }
  return `${Number(match[1])}:${Number(match[2])}`;
}

function simplifyAspectRatio(width: number, height: number) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}

function inferUsage(prompt: string) {
  if (/(banner|kv|key visual|主视觉)/i.test(prompt)) {
    return "banner KV";
  }
  if (/(海报|poster)/i.test(prompt)) {
    return "poster";
  }
  return null;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeText(value) || null;
}

function normalizeText(value: string) {
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

function chineseImageCountToNumber(value: string) {
  const numbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  return numbers[value] ?? null;
}

function readMaxOutputImages() {
  const value = Number(process.env.SEEDREAM_MAX_OUTPUT_IMAGES ?? 4);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 4;
}
