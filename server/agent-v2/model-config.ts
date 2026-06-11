import OpenAI from "openai";
import { OpenAIChatCompletionsModel, setTracingDisabled } from "@openai/agents";

/**
 * Agent v2 runs on the OpenAI Agents SDK. When a real `OPENAI_API_KEY` is present
 * we keep the SDK defaults (native OpenAI models via the Responses API). When it
 * is not, we build an explicit Chat Completions model backed by the OpenAI-
 * compatible DeepSeek endpoint, reusing the same DeepSeek credentials the rest of
 * the app already relies on.
 *
 * Returning an explicit model instance (instead of toggling the global API mode)
 * guarantees the Chat Completions API is used — DeepSeek does not implement the
 * Responses API, so a plain model string would resolve to `/responses` and 404.
 *
 * This is provider configuration, not a runtime fallback: the provider is decided
 * once from the environment and any model/tool error still surfaces normally.
 */
let cached: OpenAIChatCompletionsModel | undefined | null = null;

export function configureAgentModelProvider() {
  // Kept for call-site clarity; provider wiring happens lazily in resolveAgentModel().
  resolveAgentModel();
}

export function resolveAgentModel(): OpenAIChatCompletionsModel | undefined {
  if (cached !== null) {
    return cached ?? undefined;
  }

  // Prefer the DeepSeek OpenAI-compatible Chat Completions endpoint whenever its
  // key is configured. This is the credential the app ships with, and it is
  // checked first so an ambient OPENAI_* proxy (which only exposes a limited
  // model set / the Responses API) does not take over agent-v2 runs.
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

  // No DeepSeek key: fall back to the SDK default (native OpenAI / ambient proxy).
  cached = undefined;
  return undefined;
}
