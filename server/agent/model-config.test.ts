import { afterEach, describe, expect, it, vi } from "vitest";

const providerEnvKeys = [
  "SUPER_RELAY_API_KEY",
  "SUPER_RELAY_MODEL",
  "SUPER_RELAY_BASE_URL",
  "ARK_API_KEY",
  "ARK_MODEL",
  "ARK_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];

describe("agent model config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("selects Super Relay before other configured providers by default", async () => {
    const { getAgentModelConfiguration, getAgentRunnerConfig } =
      await loadModelConfig({
        ARK_API_KEY: "ark-key",
        SUPER_RELAY_API_KEY: "relay-key",
      });

    expect(getAgentModelConfiguration()).toEqual({
      configured: true,
      provider: "super-relay",
      model: "opensource/glm5.2",
    });
    expect(getAgentRunnerConfig()).toMatchObject({
      provider: "super-relay",
      model: "opensource/glm5.2",
      tracingDisabled: true,
    });
  });

  it("allows a run to override the default provider", async () => {
    const { getAgentModelConfiguration, getAgentRunnerConfig } =
      await loadModelConfig({
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_MODEL: "deepseek-test",
        SUPER_RELAY_API_KEY: "relay-key",
      });

    expect(getAgentModelConfiguration("deepseek")).toEqual({
      configured: true,
      provider: "deepseek",
      model: "deepseek-test",
    });
    expect(getAgentRunnerConfig("deepseek")).toMatchObject({
      provider: "deepseek",
      model: "deepseek-test",
      tracingDisabled: true,
    });
  });

  it("reports an explicit provider as unconfigured when its key is missing", async () => {
    const { getAgentModelConfiguration, getAgentRunnerConfig } =
      await loadModelConfig({
        SUPER_RELAY_API_KEY: "relay-key",
      });

    expect(getAgentModelConfiguration("openai")).toEqual({
      configured: false,
      provider: null,
      model: null,
    });
    expect(() => getAgentRunnerConfig("openai")).toThrow(
      'Agent model provider "openai" is not configured. Set OPENAI_API_KEY.'
    );
  });
});

async function loadModelConfig(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const key of providerEnvKeys) {
    vi.stubEnv(key, "");
  }
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import("./model-config.ts");
}
