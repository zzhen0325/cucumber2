import { parse as parseYaml } from "yaml";

export type AgentSkillScope = "image";
export type AgentSkillPurpose = "prompt_expansion";
export type AgentSkillSourceType = "manual" | "seed" | "zip";

export type ParsedAgentSkill = {
  body: string;
  description: string;
  frontmatter: Record<string, unknown>;
  name: string;
  skillMd: string;
};

const skillNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function parseAgentSkillMarkdown(markdown: string): ParsedAgentSkill {
  const skillMd = markdown.replace(/^\uFEFF/, "").trim();
  const lines = skillMd.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  );
  if (closingIndex < 0) {
    throw new Error("SKILL.md frontmatter is missing a closing delimiter.");
  }

  const frontmatterText = lines.slice(1, closingIndex).join("\n");
  const parsedFrontmatter = parseYaml(frontmatterText);
  if (!isRecord(parsedFrontmatter)) {
    throw new Error("SKILL.md frontmatter must be a YAML object.");
  }

  const name = readFrontmatterString(parsedFrontmatter, "name");
  const description = readFrontmatterString(parsedFrontmatter, "description");
  const body = lines.slice(closingIndex + 1).join("\n").trim();

  validateSkillName(name);
  if (!description) {
    throw new Error("SKILL.md frontmatter must include description.");
  }
  if (description.length > 1024) {
    throw new Error("Skill description must be 1024 characters or fewer.");
  }
  if (!body) {
    throw new Error("SKILL.md body cannot be empty.");
  }

  return {
    body,
    description,
    frontmatter: parsedFrontmatter,
    name,
    skillMd,
  };
}

export function validateSkillName(name: string) {
  if (!skillNamePattern.test(name) || name.includes("--")) {
    throw new Error(
      "Skill name must be 1-64 lowercase letters, numbers, or hyphens, without leading, trailing, or repeated hyphens."
    );
  }
}

function readFrontmatterString(
  frontmatter: Record<string, unknown>,
  key: string
) {
  const value = frontmatter[key];
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
