import type { CucumberAgentContext } from "../context.ts";

// Task Frame is an observability and retrieval signal, not an execution
// permission system. These helpers stay as stable call-site hooks while the
// concrete tools enforce their own schemas, URL rules, storage policy, and
// canvas-operation policy.
export function assertImageToolAllowed(
  context: CucumberAgentContext,
  toolName: string
) {
  void context;
  void toolName;
}

export function assertTextArtifactToolAllowed(context: CucumberAgentContext) {
  void context;
}

export function assertImageInspectionToolAllowed(
  context: CucumberAgentContext,
  toolName: string,
  requiredCapability: "image-decompose"
) {
  void context;
  void toolName;
  void requiredCapability;
}
