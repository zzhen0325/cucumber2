import OpenAI from "openai";

import { BYTEARTIST_LEMO_MODEL } from "../../../../byteartist.ts";
import { normalizeSeedreamProviderPrompt } from "./generate-image.request.ts";

export type TextOnlyImageReference = {
  imageUrl: string;
  nodeId: string;
  prompt?: string;
  summary?: string;
  title?: string;
};

export type RewriteReferenceImagesForTextOnlyModelInput = {
  images: TextOnlyImageReference[];
  modelId: string;
  prompt: string;
  signal?: AbortSignal;
};

export type RewrittenReferenceImagePrompt = {
  descriptionModel: string;
  descriptionProvider: string;
  descriptions: string;
  prompt: string;
};

type ReferenceImageDescriptionConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
  provider: string;
};

const MAX_REFERENCE_IMAGES_TO_DESCRIBE = 3;

export function isLemoImagePrompt(prompt: string | undefined) {
  return /(^|[^a-z0-9])lemo([^a-z0-9]|$)/i.test(prompt ?? "");
}

export async function rewritePromptWithReferenceImagesForTextOnlyModel({
  images,
  modelId,
  prompt,
  signal,
}: RewriteReferenceImagesForTextOnlyModelInput): Promise<RewrittenReferenceImagePrompt | null> {
  const referenceImages = images
    .filter((image) => image.imageUrl.trim())
    .slice(0, MAX_REFERENCE_IMAGES_TO_DESCRIBE);
  if (!referenceImages.length) {
    return null;
  }

  const config = readReferenceImageDescriptionConfigFromEnv();
  if (!config) {
    throw new Error(
      "Reference image description is not configured. Set IMAGE_REFERENCE_DESCRIPTION_API_KEY, OPENAI_API_KEY, or ARK_API_KEY."
    );
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const response = await client.responses.create(
    {
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildReferenceRewriteInstruction({
                images: referenceImages,
                modelId,
                prompt,
              }),
            },
            ...referenceImages.map((image) => ({
              type: "input_image" as const,
              detail: "auto" as const,
              image_url: image.imageUrl,
            })),
          ],
        },
      ],
      max_output_tokens: 900,
      model: config.model,
    },
    { signal }
  );
  const text = readResponseText(response);
  const rewrittenPrompt = extractFinalPrompt(text);
  if (!rewrittenPrompt) {
    throw new Error("Reference image description returned an empty prompt.");
  }

  return {
    descriptionModel: config.model,
    descriptionProvider: config.provider,
    descriptions: truncateMetadataText(extractReferenceDescriptions(text)),
    prompt: normalizeSeedreamProviderPrompt(rewrittenPrompt),
  };
}

function buildReferenceRewriteInstruction({
  images,
  modelId,
  prompt,
}: {
  images: TextOnlyImageReference[];
  modelId: string;
  prompt: string;
}) {
  const isLemoModel = modelId === BYTEARTIST_LEMO_MODEL || isLemoImagePrompt(prompt);
  return [
    "你是图像生成 prompt 整理器。",
    `目标图像模型：${modelId}。这个模型不接收参考图，只能接收文字 prompt。`,
    "请先观察参考图，把可见的主体、构图、色彩、材质、场景、风格、文字和关键视觉线索转为中文文字描述。",
    isLemoModel
      ? "用户提到 Lemo/lemo 时，最终 prompt 必须保留 Lemo 是黄色 IP 形象这一主体约束；不要把 Lemo 当作普通 lemon 或柠檬替代。"
      : "",
    "再把参考图描述与用户需求合并，整理成一个可直接发给图像生成模型的最终生图 prompt。",
    "不要输出图片 URL，不要让模型继续参考图片，不要声称还有附件；所有参考信息都必须转成文字。",
    "输出格式必须严格如下：",
    "参考图描述：",
    "1. ...",
    "",
    "最终生图Prompt：",
    "...",
    "",
    `用户需求：${prompt}`,
    "",
    "参考图上下文：",
    ...images.map((image, index) =>
      [
        `${index + 1}. 节点 ${image.nodeId}`,
        image.title ? `标题：${image.title}` : "",
        image.summary ? `已有摘要：${image.summary}` : "",
        image.prompt ? `关联提示词：${image.prompt}` : "",
      ]
        .filter(Boolean)
        .join("；")
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

function readReferenceImageDescriptionConfigFromEnv(): ReferenceImageDescriptionConfig | null {
  const explicitKey = process.env.IMAGE_REFERENCE_DESCRIPTION_API_KEY?.trim();
  if (explicitKey) {
    return {
      apiKey: explicitKey,
      baseURL: trimTrailingSlash(process.env.IMAGE_REFERENCE_DESCRIPTION_BASE_URL),
      model:
        process.env.IMAGE_REFERENCE_DESCRIPTION_MODEL?.trim() ||
        process.env.OPENAI_MODEL?.trim() ||
        "gpt-5.4-mini",
      provider: process.env.IMAGE_REFERENCE_DESCRIPTION_PROVIDER?.trim() || "custom",
    };
  }

  const arkKey = process.env.ARK_API_KEY?.trim();
  if (arkKey) {
    return {
      apiKey: arkKey,
      baseURL: readArkOpenAICompatibleBaseUrl(),
      model:
        process.env.IMAGE_REFERENCE_DESCRIPTION_MODEL?.trim() ||
        process.env.ARK_IMAGE_REFERENCE_MODEL?.trim() ||
        process.env.ARK_MODEL?.trim() ||
        "doubao-seed-2-0-lite-260428",
      provider: "ark",
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      model:
        process.env.IMAGE_REFERENCE_DESCRIPTION_MODEL?.trim() ||
        process.env.OPENAI_MODEL?.trim() ||
        "gpt-5.4-mini",
      provider: "openai",
    };
  }

  return null;
}

function readArkOpenAICompatibleBaseUrl() {
  return (
    process.env.ARK_BASE_URL?.trim() ||
    "https://ark.cn-beijing.volces.com/api/v3"
  )
    .replace(/\/responses\/?$/, "")
    .replace(/\/+$/, "");
}

function trimTrailingSlash(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

function readResponseText(response: unknown) {
  const outputText = readStringProperty(response, "output_text");
  if (outputText) {
    return outputText;
  }

  const chunks: string[] = [];
  collectTextChunks(response, chunks);
  return chunks.join("\n").trim();
}

function collectTextChunks(value: unknown, chunks: string[]) {
  if (typeof value === "string") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextChunks(item, chunks);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const text = readStringProperty(record, "text");
  if (text) {
    chunks.push(text);
  }
  for (const item of Object.values(record)) {
    collectTextChunks(item, chunks);
  }
}

function readStringProperty(value: unknown, property: string) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const raw = (value as Record<string, unknown>)[property];
  return typeof raw === "string" ? raw.trim() : "";
}

function extractFinalPrompt(text: string) {
  const match = text.match(/最终生图\s*Prompt\s*[:：]\s*([\s\S]+)$/i);
  return normalizeSeedreamProviderPrompt(match?.[1]?.trim() || text.trim());
}

function extractReferenceDescriptions(text: string) {
  const match = text.match(/参考图描述\s*[:：]\s*([\s\S]*?)(?:最终生图\s*Prompt\s*[:：]|$)/i);
  return (match?.[1] ?? text).trim();
}

function truncateMetadataText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1197)}...` : normalized;
}
