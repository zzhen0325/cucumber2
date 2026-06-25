import type { NormalizedAgentInput } from "./input-normalizer.ts";
import { getAgentCapabilityRoute } from "./agent-capability-manifest.ts";

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
  const documentRoute = getRouteDefinition("document");
  return Boolean(
    artifact &&
      documentRoute.artifactKinds.includes(artifact.kind) &&
      ["diagram", "document", "markdown"].includes(artifact.kind)
  );
}

export function isTextArtifactTask(input?: NormalizedAgentInput | null) {
  const kind = input?.artifact?.kind;
  const documentRoute = getRouteDefinition("document");
  return Boolean(
    kind &&
      documentRoute.artifactKinds.includes(kind) &&
      ["diagram", "document", "markdown", "code", "webpage"].includes(kind)
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
  const imageRoute = getRouteDefinition("image");
  const webRoute = getRouteDefinition("web");
  const researchRoute = getRouteDefinition("research");
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
      hasAnyCapability(input, webRoute.requiredCapabilities) ? "web" : "document"
    );
    return routes;
  }
  if (input.artifact?.kind === "code") {
    routes.push("document");
    return routes;
  }
  if (
    (input.requiredCapabilities ?? []).some((capability) =>
      [
        ...researchRoute.requiredCapabilities,
        ...webRoute.requiredCapabilities,
      ].includes(capability)
    ) &&
    isDocumentArtifactTask(input)
  ) {
    if (hasAnyCapability(input, webRoute.requiredCapabilities)) {
      routes.push("web");
    }
    if (hasAnyCapability(input, researchRoute.requiredCapabilities)) {
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
  if (hasAnyCapability(input, imageRoute.requiredCapabilities)) {
    routes.push("image");
    return routes;
  }
  return routes;
}

function getRouteDefinition(route: SpecialistRoute) {
  const definition = getAgentCapabilityRoute(route);
  if (!definition) {
    throw new Error(`Missing agent capability route: ${route}`);
  }
  return definition;
}

function hasAnyCapability(
  input: NormalizedAgentInput | null | undefined,
  capabilities: string[]
) {
  const present = new Set(input?.requiredCapabilities ?? []);
  return capabilities.some((capability) => present.has(capability));
}
