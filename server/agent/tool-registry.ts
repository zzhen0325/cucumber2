export const toolScopeValues = [
  "read.canvas",
  "read.artifact",
  "read.skill",
  "write.artifact",
  "propose.canvas",
  "run.script",
  "tool.image.generate",
  "tool.image.upscale",
  "tool.image.prompt",
  "tool.web.fetch",
  "tool.doc.create",
  "tool.code.create",
  "tool.data.analyze",
] as const;

export type ToolScope = (typeof toolScopeValues)[number];

export type ToolRegistryEntry = {
  id: string;
  name: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredScopes: ToolScope[];
  producedArtifactTypes: string[];
  traceLabel: string;
  canCallExternalNetwork: boolean;
};

const objectSchema = {
  type: "object",
  additionalProperties: true,
} as const;

export const toolRegistry = {
  activate_skill: {
    id: "activate_skill",
    name: "activate_skill",
    traceLabel: "Activate skill",
    requiredScopes: ["read.skill"],
    producedArtifactTypes: [],
    canCallExternalNetwork: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        reason: { type: "string" },
        skillId: { type: "string" },
        skillName: { type: "string" },
      },
    },
    outputSchema: objectSchema,
  },
  read_skill_resource: {
    id: "read_skill_resource",
    name: "read_skill_resource",
    traceLabel: "Read skill resource",
    requiredScopes: ["read.skill"],
    producedArtifactTypes: [],
    canCallExternalNetwork: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: { type: "string", enum: ["list", "read"] },
        resourcePath: { type: "string" },
        skillId: { type: "string" },
        skillName: { type: "string" },
      },
    },
    outputSchema: objectSchema,
  },
  run_skill_script: {
    id: "run_skill_script",
    name: "run_skill_script",
    traceLabel: "Run skill script",
    requiredScopes: ["run.script"],
    producedArtifactTypes: [],
    canCallExternalNetwork: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        args: { type: "array", items: { type: "string" } },
        input: objectSchema,
        scriptName: { type: "string" },
        skillId: { type: "string" },
        stdin: { type: "string" },
      },
      required: ["skillId", "scriptName"],
    },
    outputSchema: objectSchema,
  },
  propose_canvas_operations: {
    id: "propose_canvas_operations",
    name: "propose_canvas_operations",
    traceLabel: "Propose canvas operations",
    requiredScopes: ["read.canvas", "propose.canvas"],
    producedArtifactTypes: [],
    canCallExternalNetwork: false,
    inputSchema: objectSchema,
    outputSchema: objectSchema,
  },
  expand_image_prompt: {
    id: "expand_image_prompt",
    name: "expand_image_prompt",
    traceLabel: "Expand image prompt",
    requiredScopes: ["tool.image.prompt"],
    producedArtifactTypes: [],
    canCallExternalNetwork: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string" },
        reason: { type: "string" },
      },
      required: ["prompt"],
    },
    outputSchema: objectSchema,
  },
  render_visual_style_prompt: {
    id: "render_visual_style_prompt",
    name: "render_visual_style_prompt",
    traceLabel: "Render visual style prompt",
    requiredScopes: ["read.skill", "tool.image.prompt"],
    producedArtifactTypes: [],
    canCallExternalNetwork: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        aspectRatio: { type: "string" },
        prompt: { type: "string" },
        reason: { type: "string" },
        styleSlug: { type: "string" },
        values: objectSchema,
      },
      required: ["prompt"],
    },
    outputSchema: objectSchema,
  },
  generate_image: {
    id: "generate_image",
    name: "generate_image",
    traceLabel: "Generate image",
    requiredScopes: ["read.artifact", "write.artifact", "tool.image.generate"],
    producedArtifactTypes: ["image"],
    canCallExternalNetwork: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        aspectRatio: { type: "string" },
        height: { type: "integer" },
        prompt: { type: "string" },
        resultCount: { type: "integer" },
        width: { type: "integer" },
      },
    },
    outputSchema: objectSchema,
  },
  upscale_image: {
    id: "upscale_image",
    name: "upscale_image",
    traceLabel: "Upscale image",
    requiredScopes: ["read.artifact", "write.artifact", "tool.image.upscale"],
    producedArtifactTypes: ["image"],
    canCallExternalNetwork: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        resolution: { type: "string", enum: ["4k", "8k"] },
        scale: { type: "integer" },
      },
    },
    outputSchema: objectSchema,
  },
} satisfies Record<string, ToolRegistryEntry>;

const toolScopeSet = new Set<string>(toolScopeValues);
const toolRegistryMap = new Map<string, ToolRegistryEntry>(
  Object.values(toolRegistry).map((entry) => [entry.id, entry])
);

export function getToolRegistryEntry(toolId: string) {
  return toolRegistryMap.get(toolId) ?? null;
}

export function listToolRegistryEntries() {
  return [...toolRegistryMap.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

export function validateToolBindingIds(toolIds: string[]) {
  const unknown = toolIds.filter((toolId) => !toolRegistryMap.has(toolId));
  if (unknown.length) {
    throw new Error(`Unknown tool binding(s): ${unknown.join(", ")}.`);
  }
}

export function validateToolScopes(scopes: string[]) {
  const unknown = scopes.filter((scope) => !toolScopeSet.has(scope));
  if (unknown.length) {
    throw new Error(`Unknown tool scope(s): ${unknown.join(", ")}.`);
  }
}

export function getRequiredScopesForToolBindings(toolIds: string[]): ToolScope[] {
  const scopes = new Set<ToolScope>();
  for (const toolId of toolIds) {
    const entry = getToolRegistryEntry(toolId);
    if (!entry) {
      continue;
    }
    for (const scope of entry.requiredScopes) {
      scopes.add(scope);
    }
  }
  return [...scopes].sort();
}

export function getToolTraceMetadata(toolName: string): Record<string, string> {
  const entry = getToolRegistryEntry(toolName);
  if (!entry) {
    return {};
  }
  return {
    canCallExternalNetwork: String(entry.canCallExternalNetwork),
    producedArtifactTypes: entry.producedArtifactTypes.join(","),
    requiredScopes: entry.requiredScopes.join(","),
    toolLabel: entry.traceLabel,
  };
}
