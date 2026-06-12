import { beforeAll, describe, expect, it } from "vitest";

import {
  createAgentSkillDefinition,
  createProject,
  getAgentSkillDefinition,
  getDefaultAgentSkillDefinition,
  listProjects,
  ProjectVersionConflictError,
  softDeleteAgentSkillDefinition,
  updateAgentSkillDefinition,
  updateProjectForUser,
} from "./supabase";
import type { AgentCanvasEdge, AgentCanvasNode } from "../src/types/canvas";

describe("project canvas patches", () => {
  beforeAll(() => {
    process.env.CUCUMBER_DEV_INMEMORY_DB = "1";
  });

  it("applies incremental node and edge patches and bumps the project version", async () => {
    const project = await createProject("user-patch-1", "Patch test");
    const firstNode = imageNode("image-1");
    const firstEdge = edge("edge-1", "image-1", "image-2");

    const seeded = await updateProjectForUser({
      projectId: project.id,
      userId: "user-patch-1",
      canvasPatch: {
        edgeUpserts: [firstEdge],
        nodeUpserts: [firstNode, imageNode("image-2")],
      },
      expectedVersion: project.version,
    });

    expect(seeded?.nodes).toHaveLength(2);
    expect(seeded?.edges).toHaveLength(1);
    expect(seeded?.version).toBe(project.version + 1);

    const patched = await updateProjectForUser({
      projectId: project.id,
      userId: "user-patch-1",
      canvasPatch: {
        edgeDeletes: [firstEdge.id],
        nodeDeletes: [firstNode.id],
        nodeUpserts: [stickyNode("note-1", "hello")],
      },
      expectedVersion: seeded?.version,
    });

    expect(patched?.nodes.map((node) => node.id)).toEqual(["image-2", "note-1"]);
    expect(patched?.edges).toEqual([]);
    const [summary] = await listProjects("user-patch-1");
    expect(summary.imageCount).toBe(1);
    expect(summary.nodeCount).toBe(2);
  });

  it("keeps optimistic locking for incremental patches", async () => {
    const project = await createProject("user-patch-2", "Conflict test");
    await updateProjectForUser({
      projectId: project.id,
      userId: "user-patch-2",
      canvasPatch: { nodeUpserts: [stickyNode("note-1", "server")] },
      expectedVersion: project.version,
    });

    await expect(
      updateProjectForUser({
        projectId: project.id,
        userId: "user-patch-2",
        canvasPatch: { nodeUpserts: [stickyNode("note-2", "stale")] },
        expectedVersion: project.version,
      })
    ).rejects.toBeInstanceOf(ProjectVersionConflictError);
  });
});

describe("agent skill definitions", () => {
  beforeAll(() => {
    process.env.CUCUMBER_DEV_INMEMORY_DB = "1";
  });

  it("keeps one enabled default per image prompt-expansion purpose", async () => {
    const first = await createAgentSkillDefinition(skillInput("skill-default-a"));
    const second = await createAgentSkillDefinition(skillInput("skill-default-b"));

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(true);
    await expect(getAgentSkillDefinition(first.id)).resolves.toMatchObject({
      isDefault: false,
    });
    await expect(
      getDefaultAgentSkillDefinition({
        agentScope: "image",
        purpose: "prompt_expansion",
      })
    ).resolves.toMatchObject({ id: second.id, name: "skill-default-b" });

    const disabled = await updateAgentSkillDefinition({
      id: second.id,
      enabled: false,
    });
    expect(disabled).toMatchObject({ enabled: false, isDefault: false });
    await expect(
      getDefaultAgentSkillDefinition({
        agentScope: "image",
        purpose: "prompt_expansion",
      })
    ).resolves.toBeNull();
  });

  it("soft-deletes skills from list/detail helpers", async () => {
    const skill = await createAgentSkillDefinition({
      ...skillInput("skill-delete-me"),
      isDefault: false,
    });

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
    isDefault: true,
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
