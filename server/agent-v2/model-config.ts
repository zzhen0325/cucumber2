import OpenAI from "openai";
import {
  OpenAIChatCompletionsModel,
  OpenAIResponsesModel,
  setTracingDisabled,
} from "@openai/agents";

/**
 * Agent v2 runs on the OpenAI Agents SDK. The provider is decided once from the
 * environment:
 *
 *   1. Doubao (Volcengine Ark) when `ARK_API_KEY` is set. Ark exposes an
 *      OpenAI-compatible Responses API, so we build an explicit
 *      `OpenAIResponsesModel` pointed at the Ark base URL.
 *   2. DeepSeek's OpenAI-compatible Chat Completions endpoint when
 *      `DEEPSEEK_API_KEY` is set. DeepSeek does not implement the Responses API,
 *      so a plain model string would resolve to `/responses` and 404 — we return
 *      an explicit `OpenAIChatCompletionsModel` instead.
 *   3. The SDK default (native OpenAI / ambient proxy) when neither is set.
 *
 * Returning an explicit model instance (instead of toggling the global API mode)
 * keeps the chosen API surface deterministic. This is provider configuration,
 * not a runtime fallback: any model/tool error still surfaces normally.
 */
type AgentModel = OpenAIResponsesModel | OpenAIChatCompletionsModel;

let cached: AgentModel | undefined | null = null;

export function configureAgentModelProvider() {
  // Kept for call-site clarity; provider wiring happens lazily in resolveAgentModel().
  resolveAgentModel();
}

export function resolveAgentModel(): AgentModel | undefined {
  if (cached !== null) {
    return cached ?? undefined;
  }

  // Prefer Doubao (Ark) whenever its key is configured. Ark speaks the
  // OpenAI-compatible Responses API.
  const arkKey = process.env.ARK_API_KEY?.trim();
  if (arkKey) {
    const baseURL = readArkOpenAICompatibleBaseUrl();
    const modelName = process.env.ARK_MODEL?.trim() || "doubao-seed-2-0-lite-260428";
    const client = new OpenAI({ apiKey: arkKey, baseURL });
    // Ark has no trace ingestion endpoint; disable tracing uploads.
    setTracingDisabled(true);
    cached = new OpenAIResponsesModel(client, modelName);
    return cached;
  }

  // Otherwise prefer the DeepSeek OpenAI-compatible Chat Completions endpoint.
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekKey) {
    const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
    const modelName = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
    const client = new OpenAI({ apiKey: deepseekKey, baseURL });
    // DeepSeek has no trace ingestion endpoint; disable tracing uploads.
    setTracingDisabled(true);
    cached = new OpenAIChatCompletionsModel(client, modelName);
    return cached;
  }

  // No provider key: fall back to the SDK default (native OpenAI / ambient proxy).
  cached = undefined;
  return undefined;
}

function readArkOpenAICompatibleBaseUrl() {
  return (process.env.ARK_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3")
    .replace(/\/responses\/?$/, "")
    .replace(/\/+$/, "");
}
