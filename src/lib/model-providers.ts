import { getResponseError } from "@/lib/api-client";

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

const modelProviderStorageKey = "cucumber:model-provider";

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return modelProviderIds.includes(value as ModelProviderId);
}

export function readStoredModelProvider() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(modelProviderStorageKey);
  return isModelProviderId(stored) ? stored : null;
}

export function storeModelProvider(providerId: ModelProviderId) {
  window.localStorage.setItem(modelProviderStorageKey, providerId);
}

export async function loadModelProviders() {
  const response = await fetch("/api/model-providers", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as {
    defaultProvider: ModelProviderId;
    providers: ModelProviderSummary[];
  };
}
