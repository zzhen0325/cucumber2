import { parse as parseYaml } from "yaml";

import {
  getRequiredScopesForToolBindings,
  validateToolBindingIds,
  validateToolScopes,
  type ToolScope,
} from "../tool-registry.ts";

export type AgentSkillScope = string;
export type AgentSkillPurpose = string;
export type AgentSkillSourceType = "manual" | "seed" | "zip";

export type AgentSkillTriggers = {
  keywords: string[];
  canvasKinds: string[];
};

export type AgentSkillBindings = {
  tools: string[];
  agents: string[];
  scopes: ToolScope[];
};

export type AgentSkillCapability = {
  operation?: string;
  artifact?: {
    kind?: string;
    subtype?: string;
    format?: string;
  };
  domain?: string;
  requiredCapabilities: string[];
  negativeCapabilities: string[];
};

export type AgentSkillScriptRuntime = "bash" | "node" | "python";

export type AgentSkillScriptManifest = {
  name: string;
  path: string;
  runtime: AgentSkillScriptRuntime;
  description: string;
  input?: unknown;
  output?: unknown;
};

export type ParsedAgentSkill = {
  agentScope: AgentSkillScope;
  body: string;
  bindings: AgentSkillBindings;
  capabilities: AgentSkillCapability[];
  description: string;
  frontmatter: Record<string, unknown>;
  name: string;
  notFor: string[];
  purpose: AgentSkillPurpose;
  produces: string[];
  scripts: AgentSkillScriptManifest[];
  skillMd: string;
  tags: string[];
  triggers: AgentSkillTriggers;
  uses: string[];
};

const skillNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const scriptNamePattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const frontmatterTokenPattern = /^[a-z0-9][a-z0-9_./:-]{0,79}$/i;

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
  const agentScope =
    readFrontmatterString(parsedFrontmatter, "agent_scope") || "general";
  const purpose =
    readFrontmatterString(parsedFrontmatter, "purpose") || "general";
  const tags = readStringArray(parsedFrontmatter.tags, "tags");
  const triggers = parseTriggers(parsedFrontmatter.triggers);
  const bindings = parseBindings(parsedFrontmatter.bindings);
  const capabilities = parseCapabilities(parsedFrontmatter.capabilities);
  const produces = readStringArray(parsedFrontmatter.produces, "produces");
  const uses = readStringArray(parsedFrontmatter.uses, "uses");
  const notFor = readStringArray(parsedFrontmatter.notFor ?? parsedFrontmatter.not_for, "notFor");
  const scripts = parseScripts(parsedFrontmatter.scripts);
  const body = lines.slice(closingIndex + 1).join("\n").trim();

  validateSkillName(name);
  validateFrontmatterToken(agentScope, "agent_scope");
  validateFrontmatterToken(purpose, "purpose");
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
    agentScope,
    body,
    bindings,
    capabilities,
    description,
    frontmatter: parsedFrontmatter,
    name,
    notFor,
    purpose,
    produces,
    scripts,
    skillMd,
    tags,
    triggers,
    uses,
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

function parseTriggers(value: unknown): AgentSkillTriggers {
  if (value === undefined || value === null) {
    return { canvasKinds: [], keywords: [] };
  }
  if (!isRecord(value)) {
    throw new Error("SKILL.md triggers must be a YAML object.");
  }

  return {
    canvasKinds: readStringArray(
      value.canvas_kinds ?? value.canvasKinds,
      "triggers.canvas_kinds"
    ),
    keywords: readStringArray(value.keywords, "triggers.keywords"),
  };
}

function parseBindings(value: unknown): AgentSkillBindings {
  if (value === undefined || value === null) {
    return { agents: [], scopes: [], tools: [] };
  }
  if (!isRecord(value)) {
    throw new Error("SKILL.md bindings must be a YAML object.");
  }

  const tools = readStringArray(value.tools, "bindings.tools");
  const declaredScopes = readStringArray(value.scopes, "bindings.scopes");
  validateToolBindingIds(tools);
  validateToolScopes(declaredScopes);

  return {
    agents: readStringArray(value.agents, "bindings.agents"),
    scopes: uniqueSortedScopes([
      ...declaredScopes,
      ...getRequiredScopesForToolBindings(tools),
    ]),
    tools,
  };
}

export function parseCapabilities(value: unknown): AgentSkillCapability[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("SKILL.md capabilities must be an array.");
  }

  return value.map((entry, index) => parseCapability(entry, `capabilities[${index}]`));
}

function parseCapability(value: unknown, label: string): AgentSkillCapability {
  if (!isRecord(value)) {
    throw new Error(`SKILL.md ${label} must be a YAML object.`);
  }

  const artifactRecord = isRecord(value.artifact) ? value.artifact : {};
  const artifact = compactRecord({
    kind: readStringEntry(value["artifact.kind"] ?? artifactRecord.kind),
    subtype: readStringEntry(value["artifact.subtype"] ?? artifactRecord.subtype),
    format: readStringEntry(value["artifact.format"] ?? artifactRecord.format),
  });

  return {
    operation: readStringEntry(value.operation),
    artifact: Object.keys(artifact).length ? artifact : undefined,
    domain: readStringEntry(value.domain),
    requiredCapabilities: readStringArray(
      value.requiredCapabilities ?? value.required_capabilities,
      `${label}.requiredCapabilities`
    ),
    negativeCapabilities: readStringArray(
      value.negativeCapabilities ?? value.negative_capabilities,
      `${label}.negativeCapabilities`
    ),
  };
}

function parseScripts(value: unknown): AgentSkillScriptManifest[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const seenNames = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`SKILL.md scripts[${index}] must be a YAML object.`);
    }

    const name = readRequiredEntryString(entry, "name", `scripts[${index}].name`);
    const scriptPath = normalizeScriptPath(
      readRequiredEntryString(entry, "path", `scripts[${index}].path`)
    );
    const runtime = readRequiredEntryString(
      entry,
      "runtime",
      `scripts[${index}].runtime`
    );
    const description = readRequiredEntryString(
      entry,
      "description",
      `scripts[${index}].description`
    );

    if (!scriptNamePattern.test(name) || name.includes("__")) {
      throw new Error(
        `Script name ${name} must be 1-64 lowercase letters, numbers, underscores, or hyphens.`
      );
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate script name ${name}.`);
    }
    seenNames.add(name);
    if (!isSupportedScriptRuntime(runtime)) {
      throw new Error(`Script ${name} runtime must be bash, node, or python.`);
    }
    validateScriptExtension(scriptPath, runtime);
    if (description.length > 1024) {
      throw new Error(`Script ${name} description must be 1024 characters or fewer.`);
    }

    return {
      description,
      input: entry.input,
      name,
      output: entry.output,
      path: scriptPath,
      runtime,
    };
  });
}

export function isSupportedScriptRuntime(
  runtime: string
): runtime is AgentSkillScriptRuntime {
  return runtime === "bash" || runtime === "node" || runtime === "python";
}

export function normalizeScriptPath(rawPath: string) {
  const path = rawPath.trim().replace(/\\/g, "/");
  const parts = path.split("/").filter(Boolean);
  if (
    !path ||
    path.startsWith("/") ||
    parts.includes("..") ||
    parts.includes(".") ||
    parts[0] !== "scripts"
  ) {
    throw new Error("Script path must stay under scripts/ without traversal.");
  }
  return parts.join("/");
}

function validateScriptExtension(path: string, runtime: string) {
  if (runtime === "node" && !/\.(?:mjs|js)$/.test(path)) {
    throw new Error("Node skill scripts must use .mjs or .js.");
  }
  if (runtime === "python" && !/\.py$/.test(path)) {
    throw new Error("Python skill scripts must use .py.");
  }
  if (runtime === "bash" && !/\.(?:bash|sh)$/.test(path)) {
    throw new Error("Bash skill scripts must use .bash or .sh.");
  }
}

function readRequiredEntryString(
  entry: Record<string, unknown>,
  key: string,
  label: string
) {
  const value = entry[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`SKILL.md ${label} is required.`);
  }
  return value.trim();
}

function readStringEntry(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`SKILL.md ${label} must be an array of strings.`);
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`SKILL.md ${label} must be an array of non-empty strings.`);
    }
    const normalized = item.trim();
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function compactRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>;
  };
}

function uniqueSortedScopes(scopes: string[]) {
  const unique = [...new Set(scopes)];
  validateToolScopes(unique);
  return unique.sort() as ToolScope[];
}

function validateFrontmatterToken(value: string, label: string) {
  if (!frontmatterTokenPattern.test(value)) {
    throw new Error(
      `SKILL.md ${label} must be 1-80 letters, numbers, underscores, dots, slashes, colons, or hyphens.`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
