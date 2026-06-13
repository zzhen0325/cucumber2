import type { CucumberAgentContext } from "../context.ts";

const runContexts = new Map<string, CucumberAgentContext>();

export function registerMcpRunContext(context: CucumberAgentContext) {
  const contextId = crypto.randomUUID();
  runContexts.set(contextId, context);
  context.mcpRunContextId = contextId;
  return contextId;
}

export function getMcpRunContext(contextId: string) {
  return runContexts.get(contextId);
}

export function unregisterMcpRunContext(contextId: string | undefined) {
  if (!contextId) {
    return;
  }
  const context = runContexts.get(contextId);
  if (context?.mcpRunContextId === contextId) {
    context.mcpRunContextId = undefined;
  }
  runContexts.delete(contextId);
}
