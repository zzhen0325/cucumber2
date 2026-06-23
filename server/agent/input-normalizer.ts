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
  "animation",
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
  "webpage.create",
  "research.answer",
  "code.create",
  "data.analyze",
  "workflow.plan",
  "image.generate",
  "image.matting",
  "image.decompose",
  "image.upscale",
  "media.analyze",
  "text.answer",
  "canvas.operation",
  "unsupported",
]);

const normalizedDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const normalizedImageVariantSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  label: z.string().trim().min(1).nullable().optional(),
});

const normalizedImageInputSchema = z.object({
  contentPrompt: z.string().trim().min(1).nullable().optional(),
  resultCount: z.number().int().positive().nullable().optional(),
  aspectRatio: z.string().trim().min(1).nullable().optional(),
  dimensions: normalizedDimensionsSchema.nullable().optional(),
  variants: z.array(normalizedImageVariantSchema).nullable().optional(),
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
  signal?: AbortSignal;
};

let normalizerRunner: Runner | undefined;
let normalizerAgent: Agent<unknown, typeof normalizedAgentInputSchema> | undefined;

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
  normalizerAgent ??= new Agent({
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
      "Classify HTML pages, H5 pages, interactive prototypes, HTML demos, and HTML animations as operation=create, artifact.kind=webpage, artifact.format=html, requiredCapabilities including html-artifact, and negativeCapabilities including image-generation.",
      "HTML animation requests such as 30秒 HTML 动画 are webpage/html artifacts, not image artifacts, unless the user explicitly asks to generate a raster image/poster/banner.",
      "Classify PRD, brief,方案,说明,邮件草稿,纪要 as document or markdown artifacts.",
      "Classify requests to edit, rewrite, polish, expand, shorten, remove parts from, or otherwise revise a prompt/text/description as operation=edit with artifact=null and negativeCapabilities including image-generation. Terse commands such as 取消标题, 去掉标题, 删除文案, or remove the title should revise the selected/upstream prompt text and must not generate images unless the user explicitly asks to generate/create/render an image now.",
      "Classify requests to analyze, evaluate, critique, summarize, or give suggestions for a visual/image/banner/poster/KV brief as operation=analyze or answer with no image artifact unless the user explicitly asks to generate/create/render the image now; include negativeCapabilities image-generation.",
      "Classify explicit long-form output requests such as detailed explanation, complete plan, roadmap, proposal, research analysis, report, 文档, 详细说明, 完整规划, 调研分析, or 长文 as operation=create or analyze with artifact.kind=document or markdown. Short QA remains artifact=null.",
      "Classify image creation as artifact.kind=image with png format, and image upscaling/enhancement of an existing image as operation=transform, artifact.kind=image.",
      "Classify image canvas extension, outpainting, resizing to new pixel dimensions, expanding a reference image to new aspect ratios, 扩图, 扩画布, 拓展尺寸, 延展画面 as operation=create, artifact.kind=image, requiredCapabilities including image-generation and image-outpaint. This is not upscale unless the user asks for 高清/超清/提升清晰度 only.",
      "Classify background removal, matting, transparent-background cutout, sticker/material extraction, or keep-only-subject requests as operation=transform, artifact.kind=image, artifact.format=png, requiredCapabilities including image-matting.",
      "Classify requests to decompose an actual selected/upstream image's style, composition, light, color, layout, or prompt clues as operation=analyze, artifact.kind=markdown, artifact.format=markdown, requiredCapabilities including image-decompose and markdown-artifact, negativeCapabilities including image-generation unless the user also explicitly asks to generate a new image.",
      "Classify requests to understand, describe, identify, summarize, judge, or extract information from an actual selected/upstream image as operation=analyze, artifact.kind=markdown, artifact.format=markdown, requiredCapabilities including media-analysis and markdown-artifact, negativeCapabilities including image-generation unless the user also explicitly asks to generate a new image.",
      "For image artifacts, separate visual content from production controls such as count, aspect ratio, pixel dimensions, and usage.",
      "When the user lists multiple output dimensions, put them in image.variants as width/height pairs and set resultCount to the number of variants.",
      "contentPrompt must be a clean renderable image description. Remove batch-count phrases such as four images, 四张, 一组4张.",
      "Keep reference image URLs out of the output. Canvas image references are handled by runtime, not by the model.",
      "Default image resultCount to 1 when the user does not request a count.",
      "Do not rely on legacy intent. If you include it, it must be consistent with operation/artifact and is only a compatibility summary.",
    ].join("\n"),
    outputType: normalizedAgentInputSchema,
  });
  return normalizerAgent;
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
  const imageCanvasExpansion = isImageCanvasExpansionRequest(raw);
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
  ]).filter(
    (capability) =>
      (!imageCanvasExpansion || capability !== "image-upscale") &&
      (!(isImageArtifact(artifact) && operation === "transform") ||
        capability !== "image-generation") &&
      (isImageArtifact(artifact) ||
        isImageInspectionCapability(capability) ||
        !isImageTaskCapability(capability))
  );
  const negativeCapabilities = uniqueCapabilityList([
    ...(ruleBased.negativeCapabilities ?? []),
    ...(parsed.negativeCapabilities ?? []),
    ...(promptTextEdit ? ["image-generation"] : []),
  ]);
  const intent = inferIntentFromProtocol({
    artifact,
    operation,
    rawPrompt: raw,
    requiredCapabilities,
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
  const variants = normalizeImageVariants(candidate?.variants, raw);
  const resultCount =
    variants.length > 0
      ? variants.length
      : candidate?.resultCount ?? inferImageResultCount(raw) ?? 1;
  if (resultCount > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const dimensions =
    candidate?.dimensions ??
    (variants.length === 1
      ? { width: variants[0].width, height: variants[0].height }
      : findExplicitDimensions(raw) ?? undefined);
  const aspectRatio =
    normalizeAspectRatio(candidate?.aspectRatio) ??
    (dimensions && variants.length <= 1
      ? simplifyAspectRatio(dimensions.width, dimensions.height)
      : undefined) ??
    findExplicitAspectRatio(raw) ??
    undefined;
  let contentPrompt =
    normalizeContentPrompt(candidate?.contentPrompt ?? raw) ||
    normalizeContentPrompt(raw) ||
    (isImageCanvasExpansionRequest(raw)
      ? "基于参考图扩展画布，保持原图主体、文字、风格、光影和构图一致，补全新增区域。"
      : "");
  if (
    isImageCanvasExpansionRequest(raw) &&
    isGenericImageReferencePrompt(contentPrompt)
  ) {
    contentPrompt =
      "基于参考图扩展画布，保持原图主体、文字、风格、光影和构图一致，补全新增区域。";
  }

  if (!contentPrompt) {
    throw new Error("Input normalization did not produce an image content prompt.");
  }

  return {
    contentPrompt,
    resultCount,
    aspectRatio,
    dimensions,
    variants: variants.length ? variants : undefined,
    usage: normalizeNullableText(candidate?.usage) ?? inferUsage(raw) ?? undefined,
    style: normalizeNullableText(candidate?.style) ?? undefined,
    subject: normalizeNullableText(candidate?.subject) ?? undefined,
    scene: normalizeNullableText(candidate?.scene) ?? undefined,
    notes: normalizeNullableText(candidate?.notes) ?? undefined,
  };
}

function buildNormalizerPrompt(input: NormalizeInput, maxOutputImages: number) {
  const upstreamSummary = input.upstreamContext
    .map(({ content, contentFormat, mimeType, nodeId, prompt, summary, title, type }) => ({
      content,
      contentFormat,
      mimeType,
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

export function isTextArtifactTask(input?: NormalizedAgentInput | null) {
  const kind = input?.artifact?.kind;
  return Boolean(
    kind && ["diagram", "document", "markdown", "code", "webpage"].includes(kind)
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

function hasAnyCapability(
  input: NormalizedAgentInput | null | undefined,
  capabilities: string[]
) {
  const present = new Set(input?.requiredCapabilities ?? []);
  return capabilities.some((capability) => present.has(capability));
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
  if (hasAnyCapability(input, ["image-decompose", "media-analysis"])) {
    routes.push("image");
    return routes;
  }
  if (isImageArtifactTask(input)) {
    routes.push("image");
    return routes;
  }
  if (input.artifact?.kind === "webpage") {
    routes.push(
      (input.requiredCapabilities ?? []).includes("web-fetch") ? "web" : "document"
    );
    return routes;
  }
  if (input.artifact?.kind === "code") {
    routes.push("document");
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
  requiredCapabilities,
}: {
  artifact?: NormalizedAgentInput["artifact"];
  operation: TaskOperation;
  rawPrompt: string;
  requiredCapabilities?: string[];
}): NormalizedIntent {
  const capabilities = new Set(requiredCapabilities ?? []);
  if (capabilities.has("image-matting")) {
    return "image.matting";
  }
  if (capabilities.has("image-decompose") && !capabilities.has("image-generation")) {
    return "image.decompose";
  }
  if (capabilities.has("media-analysis") && !capabilities.has("image-generation")) {
    return "media.analyze";
  }
  if (isImageArtifact(artifact)) {
    return operation === "transform" ? "image.upscale" : "image.generate";
  }
  if (artifact?.kind === "webpage") {
    return /(https?:\/\/|抓取|读取|fetch|read|save|保存)/i.test(rawPrompt)
      ? "web.fetch"
      : "webpage.create";
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

  if (isImageMattingRequest(prompt)) {
    return {
      artifact: { kind: "image", format: "png" },
      domain,
      negativeCapabilities: [],
      operation: "transform",
      requiredCapabilities: ["image-matting"],
    };
  }

  if (isImageDecomposeThenGenerateRequest(prompt)) {
    return {
      artifact: {
        kind: "image",
        subtype: inferImageSubtype(prompt),
        format: "png",
      },
      domain,
      negativeCapabilities: [],
      operation: "create",
      requiredCapabilities: ["image-decompose", "image-generation"],
    };
  }

  if (isAnalyzeThenGenerateRequest(prompt)) {
    return {
      artifact: {
        kind: "image",
        subtype: inferImageSubtype(prompt),
        format: "png",
      },
      domain,
      negativeCapabilities: [],
      operation: "create",
      requiredCapabilities: ["media-analysis", "image-generation"],
    };
  }

  if (isImageDecomposeRequest(prompt)) {
    return {
      artifact: { kind: "markdown", format: "markdown" },
      domain: "visual-design",
      negativeCapabilities: ["image-generation"],
      operation: "analyze",
      requiredCapabilities: ["image-decompose", "markdown-artifact"],
    };
  }

  if (isMediaAnalyzeRequest(prompt)) {
    return {
      artifact: { kind: "markdown", format: "markdown" },
      domain,
      negativeCapabilities: ["image-generation"],
      operation: "analyze",
      requiredCapabilities: ["media-analysis", "markdown-artifact"],
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

  if (isImageCanvasExpansionRequest(prompt)) {
    return {
      artifact: {
        kind: "image",
        subtype: inferImageSubtype(prompt),
        format: "png",
      },
      domain: domain === "general" ? "visual-design" : domain,
      negativeCapabilities: [],
      operation: "create",
      requiredCapabilities: ["image-generation", "image-outpaint"],
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

  if (isHtmlArtifactCreationRequest(prompt)) {
    return {
      artifact: {
        kind: "webpage",
        subtype: inferHtmlArtifactSubtype(prompt),
        format: "html",
      },
      domain,
      negativeCapabilities: ["image-generation"],
      operation: inferEditOperation(prompt) ? "edit" : "create",
      requiredCapabilities: inferHtmlArtifactCapabilities(prompt),
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
  if (
    isImageMattingRequest(rawPrompt) ||
    isImageDecomposeThenGenerateRequest(rawPrompt) ||
    isAnalyzeThenGenerateRequest(rawPrompt) ||
    isImageDecomposeRequest(rawPrompt) ||
    isMediaAnalyzeRequest(rawPrompt)
  ) {
    return inferred ?? null;
  }
  if (isVisualBriefAnalysisRequest(rawPrompt) && artifact.kind === "image") {
    return null;
  }
  if (isImageCanvasExpansionRequest(rawPrompt)) {
    return inferred ?? { kind: "image", format: "png" };
  }
  if (/(流程\s*时序图|时序图|sequence\s*diagram)/i.test(rawPrompt)) {
    return { kind: "diagram", subtype: "sequenceDiagram", format: "mermaid" };
  }
  if (
    /(流程图|flowchart|流程\s*图)/i.test(rawPrompt) &&
    !hasExplicitImageCreationRequest(rawPrompt)
  ) {
    return { kind: "diagram", subtype: "flowchart", format: "mermaid" };
  }
  if (isHtmlArtifactCreationRequest(rawPrompt)) {
    return {
      kind: "webpage",
      subtype: inferHtmlArtifactSubtype(rawPrompt),
      format: "html",
    };
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
  if (isImageMattingRequest(rawPrompt)) {
    return "transform";
  }
  if (isImageDecomposeRequest(rawPrompt) || isMediaAnalyzeRequest(rawPrompt)) {
    return "analyze";
  }
  if (isVisualBriefAnalysisRequest(rawPrompt)) {
    return "analyze";
  }
  if (isImageArtifact(artifact) && isImageCanvasExpansionRequest(rawPrompt)) {
    return "create";
  }
  if (isImageArtifact(artifact) && /(放大|高清|超清|提升清晰|upscale|enhance)/i.test(rawPrompt)) {
    return "transform";
  }
  if (isImageArtifact(artifact) && operation === "answer") {
    return "create";
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
  if (/(视觉|H5|HTML|网页|页面|动画|动效|海报|banner|KV|主视觉|画面|构图|风格|色彩|poster|visual|animation|motion)/i.test(prompt)) {
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

function isHtmlArtifactCreationRequest(prompt: string) {
  if (hasExplicitImageCreationRequest(prompt)) {
    return false;
  }
  if (/(抓取|读取|总结|概括|整理|fetch|read|summari[sz]e)/i.test(prompt)) {
    return false;
  }

  const hasHtmlSurface =
    /\bhtml\b|网页|网页文件|web\s?page|webpage|页面|H5|h5/i.test(prompt);
  if (!hasHtmlSurface) {
    return false;
  }

  const asksToCreate =
    /(做|制作|生成|创建|写|产出|输出|实现|开发|搭建|build|create|make|write|implement)/i.test(
      prompt
    );
  const htmlOutput =
    /(动画|动效|交互|互动|demo|演示|原型|prototype|页面|网页|webpage|website|landing|H5|h5)/i.test(
      prompt
    );

  return asksToCreate && htmlOutput;
}

function inferHtmlArtifactSubtype(prompt: string): TaskArtifactSubtype | undefined {
  if (/(动画|动效|motion|animation|30秒|60fps|视频素材)/i.test(prompt)) {
    return "animation";
  }
  return undefined;
}

function inferHtmlArtifactCapabilities(prompt: string) {
  return uniqueCapabilityList([
    "html-artifact",
    ...(inferHtmlArtifactSubtype(prompt) === "animation" ? ["animation"] : []),
  ]);
}

function isImageTaskCapability(capability: string) {
  return /image|图片|图像|upscale|outpaint|视觉风格|prompt[-_ ]?expansion/i.test(capability);
}

function isImageInspectionCapability(capability: string) {
  return capability === "image-decompose" || capability === "media-analysis";
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

function isImageMattingRequest(prompt: string) {
  return /(抠图|去背景|去除背景|移除背景|删除背景|透明底|透明背景|只要人物|只要主体|提取主体|主体提取|做贴纸|贴纸素材|素材提取|remove\s+background|transparent\s+background|cutout|matting)/i.test(
    prompt
  );
}

function isImageDecomposeThenGenerateRequest(prompt: string) {
  return hasImageDecomposeSignal(prompt) && hasExplicitImageCreationRequest(prompt);
}

function isAnalyzeThenGenerateRequest(prompt: string) {
  return hasMediaAnalyzeSignal(prompt) && hasExplicitImageCreationRequest(prompt);
}

function isImageDecomposeRequest(prompt: string) {
  return hasImageDecomposeSignal(prompt) && !hasExplicitImageCreationRequest(prompt);
}

function isMediaAnalyzeRequest(prompt: string) {
  return hasMediaAnalyzeSignal(prompt) && !hasExplicitImageCreationRequest(prompt);
}

function hasImageDecomposeSignal(prompt: string) {
  if (!hasActualImageCue(prompt)) {
    return false;
  }
  return /(拆|拆解|分析|提取|总结).{0,24}(风格|构图|光影|配色|色彩|镜头|版式|布局|prompt|提示词|视觉线索)|(风格|构图|光影|配色|色彩|镜头|版式|布局|prompt|提示词|视觉线索).{0,24}(拆|拆解|分析|提取|总结)/i.test(
    prompt
  );
}

function hasMediaAnalyzeSignal(prompt: string) {
  if (!hasActualImageCue(prompt)) {
    return false;
  }
  return /(看懂|识别|描述|总结|提取|判断|理解|解释|图里有什么|图中有什么|图片里有什么|表达了什么|关键信息|内容|元素|describe|identify|summari[sz]e|extract|understand)/i.test(
    prompt
  );
}

function hasActualImageCue(prompt: string) {
  return /(这张图|这张图片|这张照片|此图|图里|图中|图片里|图片中|照片里|照片中|选中的图|选中图片|参考图|reference image|selected image|this image|this picture|photo)/i.test(
    prompt
  );
}

function isGenericImageReferencePrompt(prompt: string) {
  const normalized = normalizeText(prompt)
    .replace(/[\s,，:：;；.。/\\|_-]+/g, " ")
    .trim();
  return /^(?:把|将|给我|帮我)?\s*(?:这个|这张|当前|选中|参考)?\s*(?:图|图片|图像|画布|image|picture)\s*$/i.test(
    normalized
  );
}

function isImageCanvasExpansionRequest(prompt: string) {
  const hasExpansionCue =
    /(扩图|扩画布|扩边|补边|外扩|外延|延展|拓展|扩展|拓宽|扩充|outpaint|outpainting|extend(?:\s+the)?\s+canvas|canvas\s+extension|expand(?:\s+the)?\s+image)/i.test(
      prompt
    );
  const hasDimensionResizeCue =
    /(拓展|扩展|扩图|调整|改成|转成|resize|尺寸|版位|比例|aspect\s*ratio).{0,24}(尺寸|画布|比例|版位|\d{3,5}\s*(?:x|×|\*|-|–|—)\s*\d{3,5})/i.test(
      prompt
    );
  const hasDimensionList = findDimensionVariants(prompt).length > 0;
  return (
    (hasExpansionCue || hasDimensionResizeCue) &&
    (hasActualImageCue(prompt) || hasDimensionList)
  );
}

function hasExplicitImageCreationRequest(prompt: string) {
  return /((生成|创建|画|出图|渲染|产出|输出|制作).{0,16}(图片|图像|图|海报|banner|kv|主视觉)|(生成|创建|设计|制作|做|产出|输出|出).{0,24}(角色|IP|形象|头像|玩偶|公仔|毛绒|贴纸)|(图片|图像|海报|banner|kv|主视觉|角色|IP|形象|头像|玩偶|公仔|毛绒|贴纸).{0,24}(生成|创建|渲染|产出|输出|制作|设计)|\b(generate|create|render|make)\b.{0,48}\b(image|poster|banner|key visual|character|avatar|mascot)\b)/i.test(
    prompt
  );
}

function inferImageResultCount(prompt: string) {
  const dimensionVariants = findDimensionVariants(prompt);
  if (dimensionVariants.length > 1) {
    return dimensionVariants.length;
  }

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
    .replace(/\b\d{3,5}\s*(?:x|×|\*|-|–|—)\s*\d{3,5}\b/gi, " ")
    .replace(/(?:拓展|扩展|扩图|调整|改成|转成)?\s*\d{1,2}\s*个\s*尺寸/gi, " ")
    .replace(/(?:拓展|扩展|扩图|扩画布|延展|外扩|outpaint|resize)(?:这张|这个|当前|选中)?(?:图|图片|画布)?/gi, " ")
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
  const dimensionMatch = findDimensionVariants(prompt)[0];
  if (!dimensionMatch) {
    return null;
  }
  return {
    width: dimensionMatch.width,
    height: dimensionMatch.height,
  };
}

function normalizeImageVariants(
  candidateVariants: NormalizedImageInput["variants"],
  prompt: string
) {
  const promptVariants = findDimensionVariants(prompt);
  const candidates =
    candidateVariants && candidateVariants.length
      ? candidateVariants
      : isImageCanvasExpansionRequest(prompt) || promptVariants.length > 1
        ? promptVariants
        : [];
  const seen = new Set<string>();
  return candidates.flatMap((variant) => {
    const width = Math.floor(Number(variant.width));
    const height = Math.floor(Number(variant.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return [];
    }
    const key = `${width}x${height}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      width,
      height,
      label: normalizeNullableText(variant.label) ?? undefined,
    }];
  });
}

function findDimensionVariants(prompt: string) {
  const variants: Array<{ width: number; height: number; label?: string }> = [];
  const seen = new Set<string>();
  const dimensionPattern =
    /(^|[^\d])(\d{3,5})\s*(?:x|×|\*|-|–|—)\s*(\d{3,5})(?=$|[^\d])/gi;
  for (const match of prompt.matchAll(dimensionPattern)) {
    const width = Number(match[2]);
    const height = Number(match[3]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      continue;
    }
    const key = `${width}x${height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    variants.push({
      width,
      height,
      label: `${width}x${height}`,
    });
  }
  return variants;
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
