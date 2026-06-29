import { tool } from "@openai/agents";
import { z } from "zod";

import type { AgentCanvasNode } from "../../../../src/types/canvas.ts";
import { searchKnowledgeChunks } from "../../knowledge/knowledge-index.ts";
import { listAgentKnowledgeChunksForProject } from "../../../supabase.ts";
import type { CucumberAgentContext } from "../../context.ts";

const searchKnowledgeInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(12)
    .describe("Maximum number of matching knowledge chunks to return.")
    .default(6),
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Search query for uploaded or generated project knowledge."),
  sourceNodeIds: z
    .array(z.string().trim().min(1).max(260))
    .max(20)
    .describe("Optional trusted project node ids to restrict retrieval to.")
    .optional(),
});

export const searchKnowledgeTool = tool({
  name: "search_knowledge",
  description:
    "Search trusted project knowledge artifacts created from imported documents, webpages, images, datasets, and generated artifacts. Use when the user asks to reference, compare, summarize, reuse, or answer from project materials beyond the short upstream context.",
  parameters: searchKnowledgeInputSchema,
  strict: true,
  errorFunction: null,
  async execute(args, runContext) {
    const context = requireCucumberContext(runContext?.context);

    const chunks = await listAgentKnowledgeChunksForProject({
      projectId: context.projectId,
      userId: context.userId,
    });
    if (!chunks) {
      return { error: "project_not_found" };
    }

    const visible = getVisibleKnowledgeSources(
      context.canvasSnapshot.nodes,
      args.sourceNodeIds
    );
    const results = searchKnowledgeChunks({
      chunks,
      limit: args.limit,
      query: args.query,
      visibleSourceArtifactIds: visible.artifactIds,
      visibleSourceNodeIds: visible.nodeIds,
    });

    return {
      query: args.query,
      resultCount: results.length,
      results: results.map((result) => ({
        artifactType: result.artifactType,
        chunkId: result.chunkId,
        keywords: result.keywordIndex.slice(0, 12),
        score: result.score,
        sourceArtifactId: result.sourceArtifactId,
        sourceNodeId: result.sourceNodeId,
        textExcerpt: result.textExcerpt,
        textExcerptDigest: result.textExcerptDigest,
        title: result.title,
        updatedAt: result.updatedAt,
      })),
    };
  },
});

function getVisibleKnowledgeSources(
  nodes: AgentCanvasNode[],
  requestedSourceNodeIds: string[] | undefined
) {
  const allVisibleNodeIds = new Set(nodes.map((node) => node.id));
  const nodeIds = requestedSourceNodeIds?.length
    ? new Set(requestedSourceNodeIds.filter((nodeId) => allVisibleNodeIds.has(nodeId)))
    : allVisibleNodeIds;

  const artifactIds = new Set<string>();
  for (const node of nodes) {
    if (!nodeIds.has(node.id)) {
      continue;
    }
    const artifactId = getNodeArtifactId(node);
    if (artifactId) {
      artifactIds.add(artifactId);
    }
  }

  return { artifactIds, nodeIds };
}

function getNodeArtifactId(node: AgentCanvasNode) {
  if (node.data.kind === "imageResult") {
    return node.data.artifact?.id ?? node.data.image.artifact?.id ?? node.data.image.id;
  }
  if ("artifact" in node.data) {
    return node.data.artifact.id;
  }
  return null;
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
