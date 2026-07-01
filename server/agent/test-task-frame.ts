import type { NormalizedAgentInput, PrimaryAgent, TaskAction, TaskDomain } from "./task-frame.ts";

export function makeTaskFrame(
  overrides: {
    rawInput?: string;
    domain?: TaskDomain;
    intent?: string;
    action?: TaskAction;
    confidence?: number;
    primaryAgent?: PrimaryAgent;
    candidateAgents?: PrimaryAgent[];
    reason?: string;
    text?: string;
    images?: NormalizedAgentInput["inputs"]["images"];
    files?: NormalizedAgentInput["inputs"]["files"];
    explicit?: NormalizedAgentInput["constraints"]["explicit"];
    inferred?: NormalizedAgentInput["constraints"]["inferred"];
    ambiguities?: NormalizedAgentInput["ambiguities"];
    workflow?: Partial<NormalizedAgentInput["workflow"]>;
  } = {}
): NormalizedAgentInput {
  const rawInput = overrides.rawInput ?? "task";
  return {
    rawInput,
    task: {
      domain: overrides.domain ?? "text",
      intent: overrides.intent ?? "text.answer",
      action: overrides.action ?? "analyze",
      confidence: overrides.confidence ?? 0.9,
    },
    userGoal: {
      original: rawInput,
      normalized: overrides.text ?? rawInput,
    },
    routing: {
      primaryAgent: overrides.primaryAgent ?? "manager_agent",
      candidateAgents: overrides.candidateAgents ?? [],
      reason: overrides.reason,
    },
    inputs: {
      text: overrides.text ?? rawInput,
      images: overrides.images ?? [],
      files: overrides.files ?? [],
    },
    constraints: {
      explicit: overrides.explicit ?? [],
      inferred: overrides.inferred ?? [],
    },
    ambiguities: overrides.ambiguities ?? [],
    workflow: {
      mode: overrides.workflow?.mode ?? "single",
      inputModalities: overrides.workflow?.inputModalities ?? [],
      outputArtifacts: overrides.workflow?.outputArtifacts ?? [],
      requiredAgents: overrides.workflow?.requiredAgents ?? [],
      requiredCapabilities: overrides.workflow?.requiredCapabilities ?? [],
      stages: overrides.workflow?.stages ?? [],
    },
  };
}
