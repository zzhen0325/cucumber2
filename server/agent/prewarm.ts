import { prewarmCucumberInternalMcpConnection } from "./mcp/internal-mcp-client.ts";
import { configureAgentModelProvider } from "./model-config.ts";
import { prewarmAgentRuntimeWorld } from "./runtime.ts";
import { prewarmAgentSkillRegistry } from "./skills/skill-registry.ts";

let prewarmPromise: Promise<void> | null = null;

export function scheduleAgentRunPrewarm() {
  if (!prewarmPromise) {
    prewarmPromise = prewarmAgentRunDependencies().finally(() => {
      prewarmPromise = null;
    });
  }
  void prewarmPromise;
}

async function prewarmAgentRunDependencies() {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => configureAgentModelProvider()),
    Promise.resolve().then(() => prewarmAgentRuntimeWorld()),
    prewarmAgentSkillRegistry(),
    prewarmCucumberInternalMcpConnection(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[agent-run:prewarm]", result.reason);
    }
  }
}
