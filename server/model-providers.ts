import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  Output,
  generateText,
  streamText,
  type InferUIMessageChunk,
  type UIMessage,
} from "ai";
import type { z } from "zod";

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

type StructuredGenerationInput<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName?: string;
  schemaDescription?: string;
  maxOutputTokens?: number;
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

export async function generateStructuredObjectWithProvider<T>(
  providerId: ModelProviderId,
  input: StructuredGenerationInput<T>
): Promise<T> {
  assertTextProviderConfigured(providerId);

  if (providerId === "deepseek") {
    const jsonModeInput = withJsonModeInstruction(input);
    const result = await generateText({
      model: getDeepSeekModel(),
      system: jsonModeInput.system,
      prompt: jsonModeInput.prompt,
      maxOutputTokens: jsonModeInput.maxOutputTokens,
      output: Output.object({
        schema: jsonModeInput.schema,
        name: jsonModeInput.schemaName,
        description: jsonModeInput.schemaDescription,
      }),
    });

    return input.schema.parse(result.output);
  }

  const text = await generateArkText({
    system: input.system,
    prompt: [
      input.prompt,
      "",
      "Return only a JSON object matching the requested schema. Do not wrap it in Markdown.",
    ].join("\n"),
    maxOutputTokens: input.maxOutputTokens,
  });

  return input.schema.parse(parseJsonObjectText(text));
}

export function withJsonModeInstruction<T>(
  input: StructuredGenerationInput<T>
): StructuredGenerationInput<T> {
  const instruction =
    "Return only a valid JSON object matching the requested schema. Do not wrap the JSON in Markdown.";
  const systemContainsJson = /\bjson\b/i.test(input.system);
  const promptContainsJson = /\bjson\b/i.test(input.prompt);
  if (systemContainsJson && promptContainsJson) {
    return input;
  }

  return {
    ...input,
    system: systemContainsJson
      ? input.system
      : [input.system, instruction].join("\n"),
    prompt: promptContainsJson
      ? input.prompt
      : [input.prompt, "", instruction].join("\n"),
  };
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

  const body = await response.json();
  const text = extractArkResponseText(body).trim();
  if (!text) {
    throw new Error(
      `Ark Responses API returned an empty response. ${summarizeArkResponseForError(body)}`
    );
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

function parseJsonObjectText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Structured model output was not valid JSON.");
  }
}

function summarizeArkResponseForError(body: unknown) {
  if (!body || typeof body !== "object") {
    return `Response body type: ${typeof body}.`;
  }

  const candidate = body as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of ["status", "finish_reason", "stop_reason"]) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      parts.push(`${key}=${value.trim()}`);
    }
  }

  const incompleteDetails = summarizeUnknownField(candidate.incomplete_details);
  if (incompleteDetails) {
    parts.push(`incomplete_details=${incompleteDetails}`);
  }

  const error = summarizeUnknownField(candidate.error);
  if (error) {
    parts.push(`error=${error}`);
  }

  if (Array.isArray(candidate.output)) {
    parts.push(`output_items=${candidate.output.length}`);
    const outputTypes = candidate.output
      .map((item) =>
        item && typeof item === "object"
          ? readShortString((item as Record<string, unknown>).type)
          : typeof item
      )
      .filter(Boolean);
    if (outputTypes.length) {
      parts.push(`output_types=${outputTypes.join(",")}`);
    }
  }

  if (Array.isArray(candidate.choices)) {
    parts.push(`choices=${candidate.choices.length}`);
    const finishReasons = candidate.choices
      .map((choice) =>
        choice && typeof choice === "object"
          ? readShortString((choice as Record<string, unknown>).finish_reason)
          : undefined
      )
      .filter(Boolean);
    if (finishReasons.length) {
      parts.push(`choice_finish_reasons=${finishReasons.join(",")}`);
    }
  }

  if (!parts.length) {
    parts.push(`keys=${Object.keys(candidate).slice(0, 8).join(",") || "none"}`);
  }

  return parts.join("; ") + ".";
}

function summarizeUnknownField(value: unknown) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return truncateForError(value.trim());
  }
  try {
    return truncateForError(JSON.stringify(value));
  } catch {
    return truncateForError(String(value));
  }
}

function readShortString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? truncateForError(value.trim(), 48)
    : undefined;
}

function truncateForError(value: string, maxLength = 180) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function collectTextFields(value: unknown, seen = new WeakSet<object>()): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFields(item, seen));
  }
  if (typeof value !== "object") {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }
  seen.add(value);

  const candidate = value as Record<string, unknown>;
  const directText = [candidate.text, candidate.output_text]
    .filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    )
    .map((item) => item.trim());

  return [
    ...directText,
    ...collectTextFields(candidate.content, seen),
    ...collectTextFields(candidate.message, seen),
    ...collectTextFields(candidate.delta, seen),
    ...collectTextFields(candidate.parts, seen),
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
