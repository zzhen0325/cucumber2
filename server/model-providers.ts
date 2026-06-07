import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  streamText,
  type InferUIMessageChunk,
  type UIMessage,
} from "ai";

export const modelProviderIds = ["deepseek", "ark"] as const;
export type ModelProviderId = (typeof modelProviderIds)[number];

export type ModelProviderSummary = {
  id: ModelProviderId;
  label: string;
  configured: boolean;
  model: string;
  capabilities: {
    text: boolean;
    vision: boolean;
  };
};

type TextGenerationInput = {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  imageUrls?: string[];
};

type ArkResponsesRequestInput = {
  inputText: string;
  imageUrls?: string[];
  maxOutputTokens?: number;
  model: string;
};

type ArkResponsesContentPart =
  | {
      type: "input_image";
      image_url: string;
    }
  | {
      type: "input_text";
      text: string;
    };

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return modelProviderIds.includes(value as ModelProviderId);
}

export function getDefaultModelProviderId(): ModelProviderId {
  const fromEnv = process.env.AGENT_MODEL_PROVIDER ?? process.env.DEFAULT_MODEL_PROVIDER;
  return isModelProviderId(fromEnv) ? fromEnv : "deepseek";
}

export function getModelProviderSummaries(): ModelProviderSummary[] {
  return [
    {
      id: "deepseek",
      label: "DeepSeek",
      configured: isDeepSeekConfigured(),
      model: readDeepSeekModelName(),
      capabilities: { text: true, vision: false },
    },
    {
      id: "ark",
      label: "Ark",
      configured: isArkConfigured(),
      model: readArkModelName(),
      capabilities: { text: true, vision: true },
    },
  ];
}

export function isArkConfigured() {
  return Boolean(process.env.ARK_API_KEY);
}

export function isDeepSeekConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function readArkMaxReferenceImagesFromEnv() {
  return readNumberEnv("ARK_MAX_REFERENCE_IMAGES", 4);
}

export async function generateTextWithProvider(
  providerId: ModelProviderId,
  input: TextGenerationInput
) {
  assertTextProviderConfigured(providerId);

  if (providerId === "deepseek") {
    if (input.imageUrls?.length) {
      throw new Error("DeepSeek provider does not support reference image analysis.");
    }

    const result = await generateText({
      model: getDeepSeekModel(),
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens,
    });

    return result.text;
  }

  return generateArkText(input);
}

export async function* streamTextWithProvider(
  providerId: ModelProviderId,
  input: TextGenerationInput
): AsyncIterable<InferUIMessageChunk<UIMessage>> {
  assertTextProviderConfigured(providerId);

  if (providerId === "deepseek") {
    if (input.imageUrls?.length) {
      throw new Error("DeepSeek provider does not support reference image analysis.");
    }

    const result = streamText({
      model: getDeepSeekModel(),
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens,
    });

    for await (const chunk of result.toUIMessageStream()) {
      yield chunk;
    }

    return;
  }

  const text = await generateArkText(input);
  const id = `ark-text-${crypto.randomUUID()}`;

  yield { type: "start" };
  yield { type: "start-step" };
  yield { type: "text-start", id };
  yield { type: "text-delta", id, delta: text };
  yield { type: "text-end", id };
  yield { type: "finish-step" };
  yield { type: "finish", finishReason: "stop" };
}

export function buildArkResponsesRequest({
  imageUrls = [],
  inputText,
  maxOutputTokens,
  model,
}: ArkResponsesRequestInput) {
  const content: ArkResponsesContentPart[] = [
    ...imageUrls.map((imageUrl) => ({
      type: "input_image" as const,
      image_url: imageUrl,
    })),
    {
      type: "input_text",
      text: inputText,
    },
  ];
  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content,
      },
    ],
  };

  if (maxOutputTokens) {
    body.max_output_tokens = maxOutputTokens;
  }

  return body;
}

export function extractArkResponseText(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const candidate = body as Record<string, unknown>;
  if (typeof candidate.output_text === "string") {
    return candidate.output_text;
  }

  const outputTexts = collectTextFields(candidate.output);
  if (outputTexts.length) {
    return outputTexts.join("\n").trim();
  }

  const choices = candidate.choices;
  if (Array.isArray(choices)) {
    return choices
      .flatMap((choice) => collectTextFields(choice))
      .join("\n")
      .trim();
  }

  return "";
}

async function generateArkText(input: TextGenerationInput) {
  const response = await fetch(readArkResponsesUrl(), {
    body: JSON.stringify(
      buildArkResponsesRequest({
        model: readArkModelName(),
        inputText: formatArkInputText(input),
        imageUrls: input.imageUrls,
        maxOutputTokens: input.maxOutputTokens,
      })
    ),
    headers: {
      Authorization: `Bearer ${readRequiredEnv("ARK_API_KEY")}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Ark Responses API failed (${response.status}): ${await response.text()}`
    );
  }

  const text = extractArkResponseText(await response.json()).trim();
  if (!text) {
    throw new Error("Ark Responses API returned an empty response.");
  }

  return text;
}

function assertTextProviderConfigured(providerId: ModelProviderId) {
  if (providerId === "deepseek" && !isDeepSeekConfigured()) {
    throw new Error("DEEPSEEK_API_KEY is required.");
  }
  if (providerId === "ark" && !isArkConfigured()) {
    throw new Error("ARK_API_KEY is required.");
  }
}

function getDeepSeekModel() {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    apiKey: readRequiredEnv("DEEPSEEK_API_KEY"),
  }).chatModel(readDeepSeekModelName());
}

function readDeepSeekModelName() {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
}

function readArkModelName() {
  return process.env.ARK_MODEL ?? "doubao-seed-2-0-lite-260428";
}

function readArkResponsesUrl() {
  const baseUrl = (process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3")
    .replace(/\/+$/, "");

  return baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`;
}

function formatArkInputText(input: TextGenerationInput) {
  return [
    "SYSTEM",
    input.system,
    "",
    "USER",
    input.prompt,
  ].join("\n");
}

function collectTextFields(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFields(item));
  }
  if (typeof value !== "object") {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const directText = [candidate.text, candidate.output_text, candidate.content]
    .filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    )
    .map((item) => item.trim());

  return [
    ...directText,
    ...collectTextFields(candidate.content),
    ...collectTextFields(candidate.message),
  ];
}

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readNumberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
