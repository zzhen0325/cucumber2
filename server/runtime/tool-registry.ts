import { createHash } from "node:crypto";
import { z } from "zod";

import {
  IMAGE_GENERATE_CAPABILITY_ID,
  PROMPT_EXPAND_CAPABILITY_ID,
  getCapabilitySummary,
  getCapability,
  requireCapability,
  type RegisteredCapability,
} from "../capabilities.ts";
import type { ModelProviderId } from "../model-providers.ts";
import type { PromptCanvasContext } from "../prompts.ts";
import type { AgentSkill } from "../supabase.ts";
import type {
  AgentStep,
  BuiltContext,
  PlanStep,
  ToolDefinition,
  ToolSummary,
} from "../../src/types/runtime.ts";
import { runtimeErrorCodes, throwAgentError } from "./errors.ts";
import {
  createAttachArtifactTool,
  createCanvasEdgeTool,
  createCanvasNodeTool,
  createUpdateCanvasNodeTool,
} from "./tools/canvas-tools.ts";
import {
  createGenerateImageTool,
  createPromptExpandTool,
  createReferenceImageTool,
  selectRuntimeReferenceImages,
} from "./tools/image-tools.ts";
import { toolIds } from "./tools/ids.ts";
import {
  createAnalyzeAssetsTool,
  createGeneratePageTool,
  createReadWebpageTool,
} from "./tools/web-page-tools.ts";

export { toolIds };

export type RuntimeToolDefinition = ToolDefinition & {
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  toPlannerToolName: string;
  prepareInput?: (input: {
    context: BuiltContext;
    previousSteps: AgentStep[];
    step: PlanStep;
  }) => unknown;
};

export class ToolRegistry {
  private readonly tools: RuntimeToolDefinition[];

  constructor(tools: RuntimeToolDefinition[]) {
    this.tools = tools;
  }

  getTool(toolId: string) {
    return this.tools.find((tool) => tool.id === toolId);
  }

  requireTool(toolId: string) {
    const tool = this.getTool(toolId);
    if (!tool) {
      throwAgentError({
        code: runtimeErrorCodes.TOOL_NOT_REGISTERED,
        message: `Unknown tool: ${toolId}`,
        retryable: false,
        severity: "error",
        toolId,
      });
    }

    return tool;
  }

  listToolsForPlanner(context: BuiltContext): ToolSummary[] {
    const allowed = new Set(context.availableTools.map((tool) => tool.id));
    return this.tools
      .filter((tool) => allowed.has(tool.id))
      .map(summarizeTool);
  }

  listAll() {
    return this.tools;
  }
}

export function buildToolRegistry({
  canvasContext,
  capabilities,
  modelProvider,
  projectId,
  runNodeId,
}: {
  canvasContext: PromptCanvasContext;
  capabilities: RegisteredCapability[];
  modelProvider: ModelProviderId;
  projectId: string;
  runNodeId: string;
}) {
  const promptExpandCapability = getCapability(
    capabilities,
    PROMPT_EXPAND_CAPABILITY_ID
  );
  const imageCapability = requireCapability(
    capabilities,
    IMAGE_GENERATE_CAPABILITY_ID
  );
  const promptSkill = promptExpandCapability?.skill as AgentSkill | undefined;

  const referenceImages = selectRuntimeReferenceImages(canvasContext);
  const tools: RuntimeToolDefinition[] = [
    createReferenceImageTool({
      imageCapability,
      canvasContext,
      referenceImages,
    }),
  ];

  if (promptExpandCapability && promptSkill) {
    tools.push(
      createPromptExpandTool({
        canvasContext,
        modelProvider,
        promptSkill,
        promptExpandCapability,
      })
    );
  }

  tools.push(
    createGenerateImageTool({
      canvasContext,
      capabilities,
      imageCapability,
      projectId,
      runNodeId,
    }),
    createReadWebpageTool(),
    createAnalyzeAssetsTool(),
    createGeneratePageTool(),
    createCanvasNodeTool({ imageCapability, projectId }),
    createCanvasEdgeTool({ imageCapability, projectId }),
    createUpdateCanvasNodeTool({ imageCapability, projectId }),
    createAttachArtifactTool({ imageCapability, projectId })
  );

  return new ToolRegistry(tools);
}

export function summarizeTool(tool: RuntimeToolDefinition): ToolSummary {
  return {
    id: tool.id,
    version: tool.version,
    capabilityId: tool.capabilityId,
    name: tool.name,
    description: tool.description,
    inputSchemaDigest: digestSchema(tool.inputSchema),
    outputSchemaDigest: digestSchema(tool.outputSchema),
    risk: tool.risk,
    policy: tool.policy,
    renderHint: tool.renderHint,
  };
}

export function getToolTraceMetadata(tool: RuntimeToolDefinition) {
  const summary = summarizeTool(tool);
  return {
    toolId: summary.id,
    capabilityId: summary.capabilityId,
    toolDefinitionVersion: summary.version,
    inputSchemaDigest: summary.inputSchemaDigest,
    outputSchemaDigest: summary.outputSchemaDigest,
    risk: summary.risk,
    renderKind: summary.renderHint.kind,
  };
}

export function selectToolsForIntent(
  toolRegistry: ToolRegistry,
  requiredToolIds: string[]
) {
  const required = new Set(requiredToolIds);
  return toolRegistry
    .listAll()
    .filter((tool) => required.has(tool.id))
    .map(summarizeTool);
}

function digestSchema(schema: z.ZodType) {
  let schemaSnapshot: unknown;
  try {
    schemaSnapshot = schema.toJSONSchema?.() ?? schema.def ?? {};
  } catch {
    schemaSnapshot = schema.def ?? { type: "custom" };
  }

  return createHash("sha256")
    .update(JSON.stringify(schemaSnapshot))
    .digest("hex");
}

export function capabilitySummaries(capabilities: RegisteredCapability[]) {
  return capabilities.map((capability) => getCapabilitySummary(capability));
}
