import { Agent, Runner } from "@openai/agents";
import { z } from "zod";

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

export const normalizedAgentInputSchema = z.object({
  rawPrompt: z.string(),
  intent: normalizedIntentSchema,
  image: normalizedImageInputSchema.nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

export type NormalizedAgentInput = z.infer<typeof normalizedAgentInputSchema>;
export type NormalizedImageInput = z.infer<typeof normalizedImageInputSchema>;
export type NormalizedIntent = z.infer<typeof normalizedIntentSchema>;

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
  model?: Agent["model"];
  signal?: AbortSignal;
};

const normalizerRunner = new Runner({ workflowName: "Cucumber Input Normalizer" });

export async function normalizeAgentInput(
  input: NormalizeInput,
  options: NormalizeAgentInputOptions = {}
): Promise<NormalizedAgentInput> {
  const maxOutputImages = options.maxOutputImages ?? readMaxOutputImages();
  const agent = createInputNormalizerAgent(options.model);
  const result = await normalizerRunner.run(
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

export function createInputNormalizerAgent(model?: Agent["model"]) {
  return new Agent({
    name: "Cucumber Input Normalizer",
    instructions: [
      "Normalize the user's request into a compact structured task object.",
      "Do not execute the task. Extract only fields that are stated or strongly implied.",
      "Classify requests to write, draft, rewrite, or structure Markdown/documents as document.create or document.edit.",
      "Classify web fetching, research, code generation, data analysis, and workflow planning with their matching intent even if the capability is not fully implemented yet.",
      "Classify image creation as image.generate and image upscaling/enhancement of an existing image as image.upscale.",
      "For image.generate, separate visual content from production controls such as count, aspect ratio, pixel dimensions, and usage.",
      "contentPrompt must be a clean renderable image description. Remove batch-count phrases such as four images, 四张, 一组4张.",
      "Keep reference image URLs out of the output. Canvas image references are handled by runtime, not by the model.",
      "Default image resultCount to 1 when the user does not request a count.",
      "Use unsupported only for requests outside the product's current capabilities.",
    ].join("\n"),
    ...(model ? { model } : {}),
    outputType: normalizedAgentInputSchema,
  });
}

export function finalizeNormalizedAgentInput(
  candidate: unknown,
  rawPrompt: string,
  options: { maxOutputImages?: number } = {}
): NormalizedAgentInput {
  const maxOutputImages = options.maxOutputImages ?? readMaxOutputImages();
  const parsed = normalizedAgentInputSchema.parse(candidate);
  const raw = normalizeText(rawPrompt);
  const intent = parsed.intent || inferIntent(raw);

  if (intent !== "image.generate" && intent !== "image.upscale") {
    return {
      rawPrompt: raw,
      intent,
      notes: normalizeNullableText(parsed.notes) ?? undefined,
    };
  }

  const image = normalizeImageRequestSlots(raw, parsed.image ?? undefined, {
    maxOutputImages,
  });

  return {
    rawPrompt: raw,
    intent,
    image,
    notes: normalizeNullableText(parsed.notes) ?? undefined,
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

function inferIntent(prompt: string): NormalizedIntent {
  if (
    /(改写|润色|重写|编辑|更新).*(文档|markdown|md|PRD|方案|brief|草稿|说明|邮件|纪要|提纲|大纲|稿)/i.test(
      prompt
    )
  ) {
    return "document.edit";
  }
  if (
    /(写|撰写|生成|创建|整理|输出|起草).*(文档|markdown|md|PRD|方案|brief|草稿|说明|邮件|纪要|提纲|大纲|稿)|\b(markdown|document|prd|brief|proposal|draft|spec)\b/i.test(
      prompt
    )
  ) {
    return "document.create";
  }
  if (/(抓取|读取|总结).*(网页|网址|链接|URL)|\b(fetch|read|summarize)\b.*\b(webpage|url|link)\b/i.test(prompt)) {
    return "web.fetch";
  }
  if (/(调研|研究|搜索|查找资料|引用来源|research|sources?|citations?)/i.test(prompt)) {
    return "research.answer";
  }
  if (/(代码|函数|组件|脚本|diff|patch|code|function|component|script)/i.test(prompt)) {
    return "code.create";
  }
  if (/(csv|表格|数据|JSON|分析数据|dataset|spreadsheet|analy[sz]e data)/i.test(prompt)) {
    return "data.analyze";
  }
  if (/(计划|拆解任务|workflow|流程|checkpoint|plan)/i.test(prompt)) {
    return "workflow.plan";
  }
  if (/(放大|高清|超清|提升清晰|upscale|enhance)/i.test(prompt)) {
    return "image.upscale";
  }
  if (
    /(生成|创建|画|出图|图片|图像|插画|海报|banner|kv|photo|image|illustration|poster)/i.test(
      prompt
    )
  ) {
    return "image.generate";
  }
  if (/(便签|形状|节点|画布)/.test(prompt)) {
    return "canvas.operation";
  }
  return "text.answer";
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
