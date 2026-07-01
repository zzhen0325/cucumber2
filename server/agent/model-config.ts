import OpenAI from "openai";
import {
  OpenAIChatCompletionsModel,
  OpenAIResponsesModel,
  setTracingDisabled,
  type Model,
  type ModelProvider,
} from "@openai/agents";

/**
 * The Agent runtime uses the official Agents SDK provider shape:
 *
 *   const runner = new Runner({ model, modelProvider })
 *
 * `model` pins the model name the SDK passes into `modelProvider.getModel()`;
 * `modelProvider` owns the endpoint/client selection. This keeps Manager,
 * specialists, input normalization, and prompt-expansion agents on one
 * provider boundary without passing concrete Model instances through agents.
 */
export type AgentModelConfiguration = {
  configured: boolean;
  provider: AgentModelProviderName | null;
  model: string | null;
};

export type AgentModelProviderName =
  | "super-relay"
  | "ark"
  | "deepseek"
  | "openai";

type AgentModelProviderProfile = {
  provider: AgentModelProviderName;
  model: string;
  modelProvider: ModelProvider;
  tracingDisabled: boolean;
};

export type AgentRunnerModelConfig = {
  provider: AgentModelProviderName;
  model: string;
  modelProvider: ModelProvider;
  tracingDisabled: boolean;
};

const cachedProfiles = new Map<string, AgentModelProviderProfile>();
let cachedInputNormalizerProfile: AgentModelProviderProfile | undefined;

export function configureAgentModelProvider(
  providerOverride?: AgentModelProviderName
) {
  getAgentModelProviderProfile(providerOverride);
}

export function getAgentRunnerConfig(
  providerOverride?: AgentModelProviderName
): AgentRunnerModelConfig {
  const profile = getAgentModelProviderProfile(providerOverride);
  return {
    model: profile.model,
    modelProvider: profile.modelProvider,
    provider: profile.provider,
    tracingDisabled: profile.tracingDisabled,
  };
}

export function getInputNormalizerRunnerConfig() {
  const profile = getInputNormalizerModelProviderProfile();
  return {
    model: profile.model,
    modelProvider: profile.modelProvider,
    tracingDisabled: profile.tracingDisabled,
  };
}

export function getAgentModelConfiguration(
  providerOverride?: AgentModelProviderName
): AgentModelConfiguration {
  const profile = readAgentModelProviderProfile(providerOverride);
  if (!profile) {
    return { configured: false, provider: null, model: null };
  }
  return {
    configured: true,
    provider: profile.provider,
    model: profile.model,
  };
}

export function supportsHostedWebSearchTool(
  providerOverride?: AgentModelProviderName
) {
  return getAgentModelConfiguration(providerOverride).provider === "openai";
}

export function isAgentModelProviderName(
  value: unknown
): value is AgentModelProviderName {
  return (
    value === "super-relay" ||
    value === "ark" ||
    value === "deepseek" ||
    value === "openai"
  );
}

function getAgentModelProviderProfile(
  providerOverride?: AgentModelProviderName
): AgentModelProviderProfile {
  const cacheKey = providerOverride ?? "auto";
  const cachedProfile = cachedProfiles.get(cacheKey);
  if (cachedProfile !== undefined) {
    return cachedProfile;
  }

  const profile = readAgentModelProviderProfile(providerOverride);
  if (!profile) {
    if (providerOverride) {
      throw new Error(
        `Agent model provider "${providerOverride}" is not configured. ${getAgentProviderSetupHint(providerOverride)}`
      );
    }
    throw new Error(
      "Agent model is not configured. Set SUPER_RELAY_API_KEY, ARK_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY."
    );
  }

  cachedProfiles.set(cacheKey, profile);
  return profile;
}

function getInputNormalizerModelProviderProfile(): AgentModelProviderProfile {
  if (cachedInputNormalizerProfile !== undefined) {
    return cachedInputNormalizerProfile;
  }

  const arkKey = process.env.ARK_API_KEY?.trim();
  if (!arkKey) {
    throw new Error("Input normalizer model is not configured. Set ARK_API_KEY.");
  }

  const model = "doubao-seed-2-0-mini-260428";
  const client = new OpenAI({
    apiKey: arkKey,
    baseURL: readArkOpenAICompatibleBaseUrl(),
  });
  setTracingDisabled(true);
  cachedInputNormalizerProfile = {
    provider: "ark",
    model,
    modelProvider: new StaticModelProvider(new OpenAIResponsesModel(client, model)),
    tracingDisabled: true,
  };
  return cachedInputNormalizerProfile;
}

function readAgentModelProviderProfile(
  providerOverride?: AgentModelProviderName
): AgentModelProviderProfile | null {
  if (providerOverride) {
    return readSpecificAgentModelProviderProfile(providerOverride);
  }

  return (
    readSpecificAgentModelProviderProfile("super-relay") ??
    readSpecificAgentModelProviderProfile("ark") ??
    readSpecificAgentModelProviderProfile("deepseek") ??
    readSpecificAgentModelProviderProfile("openai")
  );
}

function readSpecificAgentModelProviderProfile(
  provider: AgentModelProviderName
): AgentModelProviderProfile | null {
  if (provider === "super-relay") {
    return readSuperRelayModelProviderProfile();
  }
  if (provider === "ark") {
    return readArkModelProviderProfile();
  }
  if (provider === "deepseek") {
    return readDeepSeekModelProviderProfile();
  }
  return readOpenAIModelProviderProfile();
}

function readSuperRelayModelProviderProfile(): AgentModelProviderProfile | null {
  const superRelayKey = process.env.SUPER_RELAY_API_KEY?.trim();
  if (!superRelayKey) {
    return null;
  }
  const model = process.env.SUPER_RELAY_MODEL?.trim() || "opensource/glm5.2";
  const client = new OpenAI({
    apiKey: superRelayKey,
    baseURL: readSuperRelayOpenAICompatibleBaseUrl(),
  });
  setTracingDisabled(true);
  return {
    provider: "super-relay",
    model,
    modelProvider: new StaticModelProvider(new OpenAIResponsesModel(client, model)),
    tracingDisabled: true,
  };
}

function readArkModelProviderProfile(): AgentModelProviderProfile | null {
  const arkKey = process.env.ARK_API_KEY?.trim();
  if (!arkKey) {
    return null;
  }
  const model = process.env.ARK_MODEL?.trim() || "doubao-seed-2-0-lite-260428";
  const client = new OpenAI({
    apiKey: arkKey,
    baseURL: readArkOpenAICompatibleBaseUrl(),
  });
  setTracingDisabled(true);
  return {
    provider: "ark",
    model,
    modelProvider: new StaticModelProvider(new OpenAIResponsesModel(client, model)),
    tracingDisabled: true,
  };
}

function readDeepSeekModelProviderProfile(): AgentModelProviderProfile | null {
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!deepseekKey) {
    return null;
  }
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
  const client = new OpenAI({
    apiKey: deepseekKey,
    baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  });
  setTracingDisabled(true);
  return {
    provider: "deepseek",
    model,
    modelProvider: new StaticModelProvider(
      new OpenAIChatCompletionsModel(client, model)
    ),
    tracingDisabled: true,
  };
}

function readOpenAIModelProviderProfile(): AgentModelProviderProfile | null {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return null;
  }
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
  return {
    provider: "openai",
    model,
    modelProvider: new OpenAIModelProvider(model),
    tracingDisabled: false,
  };
}

class StaticModelProvider implements ModelProvider {
  private readonly model: Model;

  constructor(model: Model) {
    this.model = model;
  }

  getModel() {
    return this.model;
  }
}

class OpenAIModelProvider implements ModelProvider {
  private readonly fallbackModel: string;

  constructor(fallbackModel: string) {
    this.fallbackModel = fallbackModel;
  }

  getModel(modelName?: string) {
    const model = modelName?.trim() || this.fallbackModel;
    return new OpenAIResponsesModel(new OpenAI(), model);
  }
}

function readArkOpenAICompatibleBaseUrl() {
  return normalizeResponsesBaseUrl(
    process.env.ARK_BASE_URL?.trim() ||
      "https://ark.cn-beijing.volces.com/api/v3"
  );
}

function readSuperRelayOpenAICompatibleBaseUrl() {
  return normalizeResponsesBaseUrl(
    process.env.SUPER_RELAY_BASE_URL?.trim() ||
      "https://super-relay.byted.org/v1"
  );
}

function normalizeResponsesBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/responses\/?$/, "").replace(/\/+$/, "");
}

function getAgentProviderSetupHint(provider: AgentModelProviderName) {
  if (provider === "super-relay") {
    return "Set SUPER_RELAY_API_KEY.";
  }
  if (provider === "ark") {
    return "Set ARK_API_KEY.";
  }
  if (provider === "deepseek") {
    return "Set DEEPSEEK_API_KEY.";
  }
  return "Set OPENAI_API_KEY.";
}
