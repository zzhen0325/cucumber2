import { beforeAll, describe, expect, it } from "vitest";

import {
  createAgentSkillDefinition,
  getAgentSkillDefinition,
  listProjects,
  softDeleteAgentSkillDefinition,
  updateAgentSkillDefinition,
} from "./supabase";
import {
  applyCanvasPatchForUser,
  createProjectForUser,
  loadCanvasSnapshotForUser,
  ProjectVersionConflictError,
} from "./canvas-store";
import type { AgentCanvasEdge, AgentCanvasNode } from "../src/types/canvas";

describe("project canvas patches", () => {
  beforeAll(() => {
    process.env.CUCUMBER_DEV_INMEMORY_DB = "1";
  });

  it("applies incremental node and edge patches and bumps the project version", async () => {
    const project = await createProjectForUser("user-patch-1", "Patch test");
    const firstNode = imageNode("image-1");
    const firstEdge = edge("edge-1", "image-1", "image-2");

    const seeded = await applyCanvasPatchForUser({
      projectId: project.id,
      userId: "user-patch-1",
      edgeUpserts: [firstEdge],
      nodeUpserts: [firstNode, imageNode("image-2")],
      expectedVersion: project.version,
    });

    expect(seeded?.version).toBe(project.version + 1);
    expect(seeded?.nodeCount).toBe(2);
    expect(seeded?.edgeCount).toBe(1);

    const patched = await applyCanvasPatchForUser({
      projectId: project.id,
      userId: "user-patch-1",
      edgeDeletes: [firstEdge.id],
      nodeDeletes: [firstNode.id],
      nodeUpserts: [stickyNode("note-1", "hello")],
      expectedVersion: seeded?.version,
    });

    const snapshot = await loadCanvasSnapshotForUser(project.id, "user-patch-1");
    expect(snapshot?.nodes.map((node) => node.id)).toEqual(["image-2", "note-1"]);
    expect(snapshot?.edges).toEqual([]);
    expect(patched?.nodeCount).toBe(2);
    expect(patched?.edgeCount).toBe(0);
    const [summary] = await listProjects("user-patch-1");
    expect(summary.imageCount).toBe(1);
    expect(summary.nodeCount).toBe(2);
  });

  it("keeps optimistic locking for incremental patches", async () => {
    const project = await createProjectForUser("user-patch-2", "Conflict test");
    await applyCanvasPatchForUser({
      projectId: project.id,
      userId: "user-patch-2",
      nodeUpserts: [stickyNode("note-1", "server")],
      expectedVersion: project.version,
    });

    await expect(
      applyCanvasPatchForUser({
        projectId: project.id,
        userId: "user-patch-2",
        nodeUpserts: [stickyNode("note-2", "stale")],
        expectedVersion: project.version,
      })
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
  });

  it("does not let stale pending run nodes overwrite materialized image results", async () => {
    const project = await createProjectForUser("user-patch-3", "Runtime guard");
    const pending = pendingRuntimeImageNode("image-pending-run-1-1");

    const withPending = await applyCanvasPatchForUser({
      projectId: project.id,
      userId: "user-patch-3",
      nodeUpserts: [pending],
      expectedVersion: project.version,
    });
    const materialized = await applyCanvasPatchForUser({
      projectId: project.id,
      userId: "user-patch-3",
      nodeUpserts: [readyRuntimeImageNode(pending.id)],
      expectedVersion: withPending?.version,
    });

    await applyCanvasPatchForUser({
      projectId: project.id,
      userId: "user-patch-3",
      nodeUpserts: [
        {
          ...pending,
          position: { x: 120, y: 80 },
        },
      ],
      expectedVersion: materialized?.version,
    });

    const snapshot = await loadCanvasSnapshotForUser(project.id, "user-patch-3");
    expect(snapshot?.nodes.find((node) => node.id === pending.id)).toMatchObject({
      position: { x: 120, y: 80 },
      data: {
        kind: "imageResult",
        artifact: { id: "image-1" },
        image: {
          id: "image-1",
          url: "/api/projects/project-1/artifacts/image-1/content",
        },
        status: "ready",
      },
    });
  });
});

describe("agent skill definitions", () => {
  beforeAll(() => {
    process.env.CUCUMBER_DEV_INMEMORY_DB = "1";
  });

  it("creates and disables skills without default state", async () => {
    const skill = await createAgentSkillDefinition(skillInput("skill-enabled"));

    expect(skill).toMatchObject({
      enabled: true,
      name: "skill-enabled",
    });
    expect(skill).not.toHaveProperty("isDefault");

    const disabled = await updateAgentSkillDefinition({
      id: skill.id,
      enabled: false,
    });
    expect(disabled).toMatchObject({ enabled: false });
    expect(disabled).not.toHaveProperty("isDefault");
  });

  it("soft-deletes skills from list/detail helpers", async () => {
    const skill = await createAgentSkillDefinition(skillInput("skill-delete-me"));

    await expect(softDeleteAgentSkillDefinition(skill.id)).resolves.toBe(true);
    await expect(getAgentSkillDefinition(skill.id)).resolves.toBeNull();
  });
});

function skillInput(name: string) {
  const skillMd = `---
name: ${name}
description: Expand compact prompts.
---

# ${name}

Return one expanded image prompt.
`;
  return {
    agentScope: "image" as const,
    body: `# ${name}\n\nReturn one expanded image prompt.`,
    description: "Expand compact prompts.",
    enabled: true,
    frontmatter: { description: "Expand compact prompts.", name },
    name,
    purpose: "prompt_expansion" as const,
    skillMd,
    sourceType: "manual" as const,
  };
}

function imageNode(id: string): AgentCanvasNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "imageResultNode",
    data: {
      image: { id, url: `/api/projects/project-1/artifacts/${id}/content` },
      kind: "imageResult",
      prompt: "upload",
      runId: "local-upload",
    },
  };
}

function pendingRuntimeImageNode(id: string): AgentCanvasNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "imageResultNode",
    data: {
      image: {
        id: "pending-run-1-1",
        title: "生成中 1/1",
        url: "",
      },
      kind: "imageResult",
      prompt: "生成一张图",
      request: { count: 1, index: 1 },
      runId: "run-1",
      status: "loading",
    },
  };
}

function readyRuntimeImageNode(id: string): AgentCanvasNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "imageResultNode",
    data: {
      artifact: {
        id: "image-1",
        type: "image",
        uri: "/api/projects/project-1/artifacts/image-1/content",
      },
      image: {
        artifact: {
          id: "image-1",
          type: "image",
          uri: "/api/projects/project-1/artifacts/image-1/content",
        },
        id: "image-1",
        url: "/api/projects/project-1/artifacts/image-1/content",
      },
      kind: "imageResult",
      prompt: "生成一张图",
      request: { count: 1, index: 1 },
      runId: "run-1",
      status: "ready",
    },
  };
}

function stickyNode(id: string, text: string): AgentCanvasNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "stickyNoteNode",
    data: {
      color: "yellow",
      createdAt: "2026-06-12T00:00:00.000Z",
      kind: "stickyNote",
      text,
    },
  };
}

function edge(id: string, source: string, target: string): AgentCanvasEdge {
  return { id, source, target };
}
