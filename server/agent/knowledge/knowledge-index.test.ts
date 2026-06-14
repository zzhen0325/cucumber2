import { describe, expect, it } from "vitest";

import type { AgentKnowledgeChunkRecord } from "../../supabase.ts";
import {
  buildKnowledgeChunksForArtifact,
  searchKnowledgeChunks,
} from "./knowledge-index.ts";

describe("knowledge index", () => {
  it("builds source-linked chunks with digest and keyword index", () => {
    const chunks = buildKnowledgeChunksForArtifact({
      artifact: {
        id: "artifact-1",
        metadata: { format: "markdown", summary: "季度销售资料" },
        mimeType: "text/markdown",
        projectId: "project-1",
        storagePath: "projects/project-1/uploads/upload-1/report.md",
        title: "Sales report",
        type: "doc",
      },
      contentText: "Q1 revenue increased because enterprise renewals improved.",
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: expect.stringContaining("artifact-1:chunk:0:"),
      projectId: "project-1",
      sourceArtifactId: "artifact-1",
      sourceNodeId: "markdown-artifact-1",
    });
    expect(chunks[0].textExcerptDigest).toMatch(/^sha256:/);
    expect(chunks[0].keywordIndex).toEqual(
      expect.arrayContaining(["revenue", "enterprise", "renewals"])
    );
  });

  it("searches only visible knowledge sources", () => {
    const chunks: AgentKnowledgeChunkRecord[] = [
      makeChunk({
        id: "chunk-visible",
        sourceArtifactId: "artifact-visible",
        sourceNodeId: "markdown-artifact-visible",
        textExcerpt: "Enterprise renewals improved revenue.",
      }),
      makeChunk({
        id: "chunk-hidden",
        sourceArtifactId: "artifact-hidden",
        sourceNodeId: "markdown-artifact-hidden",
        textExcerpt: "Enterprise renewals declined revenue.",
      }),
    ];

    const results = searchKnowledgeChunks({
      chunks,
      query: "enterprise revenue",
      visibleSourceNodeIds: new Set(["markdown-artifact-visible"]),
    });

    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe("chunk-visible");
  });
});

function makeChunk({
  id,
  sourceArtifactId,
  sourceNodeId,
  textExcerpt,
}: {
  id: string;
  sourceArtifactId: string;
  sourceNodeId: string;
  textExcerpt: string;
}): AgentKnowledgeChunkRecord {
  return {
    createdAt: "2026-06-14T00:00:00.000Z",
    embedding: null,
    id,
    keywordIndex: textExcerpt.toLowerCase().split(/\s+/).map((token) =>
      token.replace(/[^\p{L}\p{N}_-]+/gu, "")
    ),
    metadata: { sourceTitle: "Source", artifactType: "doc" },
    projectId: "project-1",
    sourceArtifactId,
    sourceNodeId,
    textExcerpt,
    textExcerptDigest: `sha256:${id}`,
    updatedAt: "2026-06-14T00:00:00.000Z",
  };
}
