// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillsPage } from "./SkillsPage";
import {
  loadAgentSkill,
  loadAgentSkillResourceText,
  loadAgentSkillResources,
  loadAgentSkills,
  updateAgentSkill,
  type AgentSkillDefinition,
  type AgentSkillDefinitionSummary,
} from "@/lib/skill-storage";

vi.mock("@/lib/skill-storage", () => ({
  createAgentSkill: vi.fn(),
  deleteAgentSkill: vi.fn(),
  fileToBase64: vi.fn(),
  downloadAgentSkillSourcePackage: vi.fn(),
  getAgentSkillResourceContentUrl: vi.fn(
    (skillId: string, resourcePath: string) =>
      `/api/agent-skills/${skillId}/resources/content?path=${resourcePath}`
  ),
  importAgentSkillZip: vi.fn(),
  loadAgentSkill: vi.fn(),
  loadAgentSkillResourceText: vi.fn(),
  loadAgentSkillResources: vi.fn(),
  loadAgentSkills: vi.fn(),
  updateAgentSkill: vi.fn(),
}));

const loadAgentSkillsMock = vi.mocked(loadAgentSkills);
const loadAgentSkillMock = vi.mocked(loadAgentSkill);
const loadAgentSkillResourceTextMock = vi.mocked(loadAgentSkillResourceText);
const loadAgentSkillResourcesMock = vi.mocked(loadAgentSkillResources);
const updateAgentSkillMock = vi.mocked(updateAgentSkill);

describe("SkillsPage", () => {
  let skill: AgentSkillDefinition;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    skill = createSkill({ enabled: false });

    loadAgentSkillsMock.mockImplementation(async () => ({
      skills: [toSummary(skill)],
    }));
    loadAgentSkillMock.mockImplementation(async () => ({ skill }));
    loadAgentSkillResourceTextMock.mockResolvedValue("{\"style\":\"clean\"}");
    loadAgentSkillResourcesMock.mockResolvedValue({
      resources: [
        {
          path: "references/style.json",
          readable: true,
          type: "reference",
        },
        {
          path: "scripts/render.mjs",
          readable: true,
          type: "script",
        },
        {
          path: "assets/preview.png",
          readable: false,
          type: "asset",
        },
      ],
    });
    updateAgentSkillMock.mockImplementation(async (input) => {
      skill = {
        ...skill,
        enabled: input.enabled ?? skill.enabled,
        updatedAt: "2026-06-14T10:00:00.000Z",
      };
      return { skill };
    });
  });

  it("enables an existing zip skill without resubmitting SKILL.md", async () => {
    render(<SkillsPage />);

    const enabledInput = (await screen.findByLabelText(
      "启用"
    )) as HTMLInputElement;
    expect(enabledInput.checked).toBe(false);

    fireEvent.click(enabledInput);

    await waitFor(() => {
      expect(updateAgentSkillMock).toHaveBeenCalledWith({
        enabled: true,
        skillId: "skill-zip",
      });
    });
    expect(updateAgentSkillMock.mock.calls[0][0]).not.toHaveProperty("skillMd");
    expect(await screen.findByText("已启用")).toBeTruthy();
    expect((screen.getByLabelText("启用") as HTMLInputElement).checked).toBe(
      true
    );
    expect(screen.getAllByText("zip-style-skill")).toHaveLength(2);
  });

  it("shows package resources for the selected skill", async () => {
    render(<SkillsPage />);

    expect((await screen.findAllByText("references/style.json")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("scripts/render.mjs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("assets/preview.png").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("{\"style\":\"clean\"}")).length).toBeGreaterThan(0);
  });

  it("keeps the new skill editor mounted when SKILL.md text changes", async () => {
    render(<SkillsPage />);

    await screen.findAllByText("zip-style-skill");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    const editor = screen.getByLabelText("SKILL.md") as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: {
        value: "---\nname: custom-skill\n---\n# Custom Skill",
      },
    });

    expect(screen.getByText("新技能")).toBeTruthy();
    expect(editor.value).toContain("custom-skill");
  });
});

function createSkill(
  overrides: Partial<AgentSkillDefinition> = {}
): AgentSkillDefinition {
  return {
    agentScope: "image",
    bindings: {
      agents: ["Cucumber Image Agent"],
      tools: ["render_visual_style_prompt"],
    },
    body: "# Zip Style Skill",
    capabilities: [],
    createdAt: "2026-06-14T09:00:00.000Z",
    createdBy: "user-1",
    description: "Zip skill with scripts",
    enabled: true,
    frontmatter: {},
    id: "skill-zip",
    name: "zip-style-skill",
    notFor: [],
    packageBucket: "agent-skill-packages",
    packagePath: "skills/zip-style-skill/package.zip",
    packageSha256: "abc123",
    packageSizeBytes: 1024,
    purpose: "prompt_expansion",
    produces: [],
    scripts: [
      {
        description: "Render prompt",
        name: "render",
        path: "scripts/render.mjs",
        runtime: "node",
      },
    ],
    skillMd: "---\nname: zip-style-skill\n---\n# Zip Style Skill",
    sourceManifest: {},
    sourceType: "zip",
    tags: ["style-json"],
    triggers: {
      canvasKinds: ["prompt"],
      keywords: ["style"],
    },
    updatedAt: "2026-06-14T09:00:00.000Z",
    uses: [],
    ...overrides,
  };
}

function toSummary(skill: AgentSkillDefinition): AgentSkillDefinitionSummary {
  return {
    agentScope: skill.agentScope,
    bindings: skill.bindings,
    capabilities: skill.capabilities,
    createdAt: skill.createdAt,
    createdBy: skill.createdBy,
    description: skill.description,
    enabled: skill.enabled,
    id: skill.id,
    name: skill.name,
    notFor: skill.notFor,
    packageBucket: skill.packageBucket,
    packagePath: skill.packagePath,
    packageSha256: skill.packageSha256,
    packageSizeBytes: skill.packageSizeBytes,
    produces: skill.produces,
    purpose: skill.purpose,
    scripts: skill.scripts,
    sourceManifest: skill.sourceManifest,
    sourceType: skill.sourceType,
    tags: skill.tags,
    triggers: skill.triggers,
    updatedAt: skill.updatedAt,
    uses: skill.uses,
  };
}
