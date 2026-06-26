import type {
  NormalizedAgentInput,
  PrimaryAgent,
  TaskAction,
} from "./input-normalizer.ts";

export type SpecialistRoute =
  | "document"
  | "image"
  | "manager"
  | "research"
  | "web";

const PRIMARY_AGENT_ROUTE: Record<PrimaryAgent, SpecialistRoute> = {
  image_agent: "image",
  document_agent: "document",
  web_agent: "web",
  research_agent: "research",
  manager_agent: "manager",
};

export function selectAgentRoute(
  input?: NormalizedAgentInput | null
): SpecialistRoute {
  if (!input) {
    return "manager";
  }
  return PRIMARY_AGENT_ROUTE[input.routing.primaryAgent] ?? "manager";
}

export function selectAgentRoutesForTask(
  input?: NormalizedAgentInput | null
): Exclude<SpecialistRoute, "manager">[] {
  if (!input) {
    return [];
  }
  const routes = new Set<Exclude<SpecialistRoute, "manager">>();
  for (const agent of [
    input.routing.primaryAgent,
    ...input.routing.candidateAgents,
  ]) {
    const route = PRIMARY_AGENT_ROUTE[agent];
    if (route && route !== "manager") {
      routes.add(route);
    }
  }
  return [...routes];
}

export function isImageTask(input?: NormalizedAgentInput | null) {
  return input?.task.domain === "image";
}

export function isImageGenerationTask(input?: NormalizedAgentInput | null) {
  return (
    isImageTask(input) &&
    !isImageInspectionAction(input?.task.action, input?.task.intent)
  );
}

export function isImageInspectionTask(input?: NormalizedAgentInput | null) {
  return (
    isImageTask(input) &&
    isImageInspectionAction(input?.task.action, input?.task.intent)
  );
}

export function isImageDecomposeTask(input?: NormalizedAgentInput | null) {
  return isImageTask(input) && /decompose|拆解/i.test(input?.task.intent ?? "");
}

export function isMediaAnalyzeTask(input?: NormalizedAgentInput | null) {
  return (
    isImageTask(input) &&
    /media\.analyze|media-analysis|理解|识别/i.test(input?.task.intent ?? "")
  );
}

export function isTextArtifactTask(input?: NormalizedAgentInput | null) {
  const domain = input?.task.domain;
  if (domain !== "text" && domain !== "code") {
    return false;
  }
  return input?.task.action === "create" ||
    input?.task.action === "edit" ||
    input?.task.action === "transform" ||
    input?.task.action === "analyze";
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
