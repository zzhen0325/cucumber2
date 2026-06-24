import type { NormalizedAgentInput } from "./input-normalizer.ts";

export type SpecialistRoute =
  | "document"
  | "image"
  | "manager"
  | "research"
  | "web";

export function isImageArtifactTask(input?: NormalizedAgentInput | null) {
  return input?.artifact?.kind === "image";
}

export function isDocumentArtifactTask(input?: NormalizedAgentInput | null) {
  const artifact = input?.artifact;
  return Boolean(
    artifact &&
      ["diagram", "document", "markdown"].includes(artifact.kind)
  );
}

export function isTextArtifactTask(input?: NormalizedAgentInput | null) {
  const kind = input?.artifact?.kind;
  return Boolean(
    kind && ["diagram", "document", "markdown", "code", "webpage"].includes(kind)
  );
}

export function isWebArtifactTask(input?: NormalizedAgentInput | null) {
  return input?.artifact?.kind === "webpage";
}

export function isResearchAnswerTask(input?: NormalizedAgentInput | null) {
  const capabilities = new Set(input?.requiredCapabilities ?? []);
  return (
    input?.operation === "answer" &&
    (capabilities.has("source-based-answer") ||
      capabilities.has("citations") ||
      capabilities.has("research"))
  );
}

export function hasNegativeCapability(
  input: NormalizedAgentInput | null | undefined,
  capability: string
) {
  return (input?.negativeCapabilities ?? []).includes(capability);
}

export function selectAgentRoute(
  input?: NormalizedAgentInput | null
): SpecialistRoute {
  const routes = selectAgentRoutesForTask(input);
  return routes.length === 1 ? routes[0] : "manager";
}

export function selectAgentRoutesForTask(
  input?: NormalizedAgentInput | null
): Exclude<SpecialistRoute, "manager">[] {
  if (!input) {
    return [];
  }
  const routes: Exclude<SpecialistRoute, "manager">[] = [];
  if (hasAnyCapability(input, ["image-decompose", "media-analysis"])) {
    routes.push("image");
    return routes;
  }
  if (isImageArtifactTask(input)) {
    routes.push("image");
    return routes;
  }
  if (input.artifact?.kind === "webpage") {
    routes.push(
      (input.requiredCapabilities ?? []).includes("web-fetch") ? "web" : "document"
    );
    return routes;
  }
  if (input.artifact?.kind === "code") {
    routes.push("document");
    return routes;
  }
  if (
    (input.requiredCapabilities ?? []).some((capability) =>
      ["research", "source-based-answer", "web-fetch"].includes(capability)
    ) &&
    isDocumentArtifactTask(input)
  ) {
    if ((input.requiredCapabilities ?? []).includes("web-fetch")) {
      routes.push("web");
    }
    if (
      (input.requiredCapabilities ?? []).some((capability) =>
        ["research", "source-based-answer", "citations"].includes(capability)
      )
    ) {
      routes.push("research");
    }
    routes.push("document");
    return routes;
  }
  if (isDocumentArtifactTask(input)) {
    routes.push("document");
    return routes;
  }
  if (isWebArtifactTask(input)) {
    routes.push("web");
    return routes;
  }
  if (isResearchAnswerTask(input)) {
    routes.push("research");
    return routes;
  }
  return routes;
}

function hasAnyCapability(
  input: NormalizedAgentInput | null | undefined,
  capabilities: string[]
) {
  const present = new Set(input?.requiredCapabilities ?? []);
  return capabilities.some((capability) => present.has(capability));
}
