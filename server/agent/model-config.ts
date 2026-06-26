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
  provider: "ark" | "deepseek" | "openai" | null;
  model: string | null;
};

type AgentModelProviderProfile = {
  provider: Exclude<AgentModelConfiguration["provider"], null>;
  model: string;
  modelProvider: ModelProvider;
  tracingDisabled: boolean;
};

let cachedProfile: AgentModelProviderProfile | undefined;
let cachedInputNormalizerProfile: AgentModelProviderProfile | undefined;

export function configureAgentModelProvider() {
  getAgentModelProviderProfile();
}

export function getAgentRunnerConfig() {
  const profile = getAgentModelProviderProfile();
  return {
    model: profile.model,
    modelProvider: profile.modelProvider,
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

export function getAgentModelConfiguration(): AgentModelConfiguration {
  const profile = readAgentModelProviderProfile();
  if (!profile) {
    return { configured: false, provider: null, model: null };
  }
  return {
    configured: true,
    provider: profile.provider,
    model: profile.model,
  };
}

export function supportsHostedWebSearchTool() {
  return getAgentModelConfiguration().provider === "openai";
}

function getAgentModelProviderProfile(): AgentModelProviderProfile {
  if (cachedProfile !== undefined) {
    return cachedProfile;
  }

  const profile = readAgentModelProviderProfile();
  if (!profile) {
    throw new Error(
      "Agent model is not configured. Set ARK_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY."
    );
  }

  cachedProfile = profile;
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

function readAgentModelProviderProfile(): AgentModelProviderProfile | null {
  const arkKey = process.env.ARK_API_KEY?.trim();
  if (arkKey) {
    const model = process.env.ARK_MODEL?.trim() || "doubao-seed-2-0-lite-260428";
    const client = new OpenAI({
      apiKey: arkKey,
      baseURL: readArkOpenAICompatibleBaseUrl(),
    });
    setTracingDisabled(true);
    return {
      provider: "ark",
      model,
      modelProvider: new StaticModelProvider(
        new OpenAIResponsesModel(client, model)
      ),
      tracingDisabled: true,
    };
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekKey) {
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

  if (process.env.OPENAI_API_KEY?.trim()) {
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
    return {
      provider: "openai",
      model,
      modelProvider: new OpenAIModelProvider(model),
      tracingDisabled: false,
    };
  }

  return null;
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
  return (process.env.ARK_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3")
    .replace(/\/responses\/?$/, "")
    .replace(/\/+$/, "");
}
