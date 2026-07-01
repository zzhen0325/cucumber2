import type { ArtifactType } from "../../src/types/canvas.ts";
import type { CapabilityRoute } from "./task-router.ts";
import { listToolRegistryEntries } from "./tool-registry.ts";

export type AgentCapabilityRoute = {
  route: CapabilityRoute;
  agentName: string;
  artifactKinds: string[];
  requiredCapabilities: string[];
  negativeCapabilities: string[];
  producedArtifactTypes: ArtifactType[];
  requiredTools: string[];
  description: string;
};

export type AgentCapabilityManifest = {
  version: "agent-capability-v1";
  routes: AgentCapabilityRoute[];
  tools: Array<{
    id: string;
    canCallExternalNetwork: boolean;
    producedArtifactTypes: string[];
    requiredScopes: string[];
  }>;
};

const routeCapabilities = [
  {
    route: "manager",
    agentName: "Super Agent general tools",
    artifactKinds: ["canvas"],
    requiredCapabilities: ["canvas-operation", "knowledge-answer"],
    negativeCapabilities: [],
    producedArtifactTypes: ["decision", "tool_result"],
    requiredTools: [
      "activate_skill",
      "read_skill_resource",
      "run_skill_script",
      "search_knowledge",
      "propose_canvas_operations",
    ],
    description:
      "General Super Agent capability for knowledge answers, skill activation, canvas operation proposals, and dynamic workflow decisions.",
  },
  {
    route: "document",
    agentName: "Super Agent document tools",
    artifactKinds: ["diagram", "document", "markdown", "code", "webpage"],
    requiredCapabilities: [
      "markdown-artifact",
      "html-artifact",
      "sequence-diagram",
      "flowchart",
      "animation",
      "code-artifact",
    ],
    negativeCapabilities: ["image-generation"],
    producedArtifactTypes: ["doc", "code", "webpage"],
    requiredTools: ["create_text_artifact"],
    description:
      "Document capability for markdown, documents, diagrams, HTML/webpage demos, code drafts, PRDs, briefs, and summaries.",
  },
  {
    route: "web",
    agentName: "Super Agent web tools",
    artifactKinds: ["webpage"],
    requiredCapabilities: ["web-fetch"],
    negativeCapabilities: [],
    producedArtifactTypes: ["webpage"],
    requiredTools: ["fetch_webpage"],
    description:
      "Web capability for fetching, reading, saving, or summarizing one public http(s) webpage as an artifact.",
  },
  {
    route: "research",
    agentName: "Super Agent research tools",
    artifactKinds: ["document", "markdown"],
    requiredCapabilities: ["research", "source-based-answer", "citations"],
    negativeCapabilities: [],
    producedArtifactTypes: ["doc"],
    requiredTools: [
      "web_search",
      "collect_research_sources",
      "create_research_artifact",
    ],
    description:
      "Research capability for web-backed comparison, synthesis, and cited answers over public web search, explicit URLs, or trusted canvas sources.",
  },
  {
    route: "image",
    agentName: "Super Agent image tools",
    artifactKinds: ["image", "markdown", "document"],
    requiredCapabilities: [
      "image-generation",
      "image-outpaint",
      "image-matting",
      "image-upscale",
      "image-decompose",
      "media-analysis",
    ],
    negativeCapabilities: [],
    producedArtifactTypes: ["image", "doc"],
    requiredTools: [
      "decompose_image",
      "generate_image",
      "image_matting",
      "upscale_image",
    ],
    description:
      "Image capability for image generation, outpainting, matting/background removal, image decomposition, native multimodal media understanding, and upscaling.",
  },
] satisfies AgentCapabilityRoute[];

export function listAgentCapabilityRoutes(): AgentCapabilityRoute[] {
  return routeCapabilities;
}

export function getAgentCapabilityRoute(
  route: CapabilityRoute
): AgentCapabilityRoute | null {
  return routeCapabilities.find((definition) => definition.route === route) ?? null;
}

export function buildAgentCapabilityManifest(): AgentCapabilityManifest {
  return {
    version: "agent-capability-v1",
    routes: routeCapabilities,
    tools: listToolRegistryEntries().map((tool) => ({
      id: tool.id,
      canCallExternalNetwork: tool.canCallExternalNetwork,
      producedArtifactTypes: tool.producedArtifactTypes,
      requiredScopes: tool.requiredScopes,
    })),
  };
}

export function buildCompactAgentCapabilityManifest() {
  const manifest = buildAgentCapabilityManifest();
  return {
    version: manifest.version,
    routes: manifest.routes.map((route) => ({
      route: route.route,
      agentName: route.agentName,
      artifactKinds: route.artifactKinds,
      requiredCapabilities: route.requiredCapabilities,
      negativeCapabilities: route.negativeCapabilities,
      producedArtifactTypes: route.producedArtifactTypes,
      requiredTools: route.requiredTools,
      description: route.description,
    })),
    tools: manifest.tools.map((tool) => ({
      id: tool.id,
      producedArtifactTypes: tool.producedArtifactTypes,
      requiredScopes: tool.requiredScopes,
      external: tool.canCallExternalNetwork,
    })),
  };
}
