import type {
  NormalizedAgentInput,
  PrimaryAgent,
  TaskAction,
  WorkflowArtifact,
} from "./task-frame.ts";

export type CapabilityRoute =
  | "document"
  | "image"
  | "manager"
  | "research"
  | "web";

const PRIMARY_AGENT_ROUTE: Record<PrimaryAgent, CapabilityRoute> = {
  image_agent: "image",
  document_agent: "document",
  web_agent: "web",
  research_agent: "research",
  manager_agent: "manager",
};

export function selectAgentRoute(
  input?: NormalizedAgentInput | null
): CapabilityRoute {
  if (!input) {
    return "manager";
  }
  if (isCompositeWorkflowTask(input)) {
    return "manager";
  }
  return PRIMARY_AGENT_ROUTE[input.routing.primaryAgent] ?? "manager";
}

export function selectAgentRoutesForTask(
  input?: NormalizedAgentInput | null
): Exclude<CapabilityRoute, "manager">[] {
  if (!input) {
    return [];
  }
  const routes = new Set<Exclude<CapabilityRoute, "manager">>();
  for (const agent of uniqueAgents([
    input.routing.primaryAgent,
    ...input.routing.candidateAgents,
    ...input.workflow.requiredAgents,
    ...input.workflow.stages.map((stage) => stage.agent),
  ])) {
    const route = PRIMARY_AGENT_ROUTE[agent];
    if (route && route !== "manager") {
      routes.add(route);
    }
  }
  return [...routes];
}

export function isImageTask(input?: NormalizedAgentInput | null) {
  return (
    input?.task.domain === "image" ||
    hasWorkflowAgent(input, "image_agent") ||
    hasWorkflowOutput(input, ["image"]) ||
    hasWorkflowCapability(input, /image-|media-analysis/)
  );
}

export function isImageGenerationTask(input?: NormalizedAgentInput | null) {
  if (!input) {
    return false;
  }
  return (
    hasWorkflowOutput(input, ["image"]) ||
    hasWorkflowCapability(input, /image-generation|image-outpaint/) ||
    (input.task.domain === "image" &&
      !isImageInspectionAction(input.task.action, input.task.intent))
  );
}

export function isImageInspectionTask(input?: NormalizedAgentInput | null) {
  if (input && input.task.domain !== "image" && hasWorkflowOutput(input, ["image"])) {
    return false;
  }
  return (
    isImageTask(input) &&
    (isImageInspectionAction(input?.task.action, input?.task.intent) ||
      hasWorkflowCapability(input, /image-decompose|media-analysis|image-analysis/))
  );
}

export function isImageDecomposeTask(input?: NormalizedAgentInput | null) {
  return (
    isImageTask(input) &&
    (/decompose|拆解/i.test(input?.task.intent ?? "") ||
      hasWorkflowCapability(input, /image-decompose/))
  );
}

export function isMediaAnalyzeTask(input?: NormalizedAgentInput | null) {
  return (
    isImageTask(input) &&
    (/media\.analyze|media-analysis|理解|识别/i.test(input?.task.intent ?? "") ||
      hasWorkflowCapability(input, /media-analysis|image-analysis/))
  );
}

export function isTextArtifactTask(input?: NormalizedAgentInput | null) {
  const domain = input?.task.domain;
  if (domain === "text" || domain === "code") {
    return input?.task.action === "create" ||
      input?.task.action === "edit" ||
      input?.task.action === "transform" ||
      input?.task.action === "analyze";
  }
  return hasWorkflowOutput(input, [
    "code",
    "diagram",
    "doc",
    "markdown",
    "webpage",
  ]);
}

export function isCompositeWorkflowTask(input?: NormalizedAgentInput | null) {
  if (!input) {
    return false;
  }
  if (input.workflow.mode === "hybrid" || input.workflow.mode === "multi_step") {
    return true;
  }
  if (input.workflow.stages.length > 1) {
    return true;
  }
  return selectAgentRoutesForTask(input).length > 1;
}

function isImageInspectionAction(
  action: TaskAction | undefined,
  intent: string | undefined
) {
  if (action === "analyze" || action === "extract") {
    return true;
  }
  return /decompose|拆解|media\.analyze|media-analysis|理解|识别/i.test(
    intent ?? ""
  );
}

function hasWorkflowAgent(
  input: NormalizedAgentInput | null | undefined,
  agent: PrimaryAgent
) {
  if (!input) {
    return false;
  }
  return (
    input.workflow.requiredAgents.includes(agent) ||
    input.workflow.stages.some((stage) => stage.agent === agent)
  );
}

function hasWorkflowCapability(
  input: NormalizedAgentInput | null | undefined,
  pattern: RegExp
) {
  if (!input) {
    return false;
  }
  return input.workflow.requiredCapabilities.some((capability) =>
    pattern.test(capability)
  );
}

function hasWorkflowOutput(
  input: NormalizedAgentInput | null | undefined,
  artifacts: WorkflowArtifact[]
) {
  if (!input) {
    return false;
  }
  const artifactSet = new Set(artifacts);
  return (
    input.workflow.outputArtifacts.some((artifact) => artifactSet.has(artifact)) ||
    input.workflow.stages.some((stage) =>
      (stage.outputArtifacts ?? []).some((artifact) => artifactSet.has(artifact))
    )
  );
}

function uniqueAgents(agents: PrimaryAgent[]): PrimaryAgent[] {
  return [...new Set(agents)];
}
