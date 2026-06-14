import { getResponseError } from "@/lib/api-client";

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
};

export type AgentSkillScriptManifest = {
  name: string;
  path?: string;
  runtime: "bash" | "node" | "python";
  description: string;
  input?: unknown;
  output?: unknown;
};

export type AgentSkillDefinitionSummary = {
  id: string;
  name: string;
  description: string;
  agentScope: AgentSkillScope;
  purpose: AgentSkillPurpose;
  tags: string[];
  triggers: AgentSkillTriggers;
  bindings: AgentSkillBindings;
  scripts: AgentSkillScriptManifest[];
  packageBucket: string | null;
  packagePath: string | null;
  packageSha256: string | null;
  packageSizeBytes: number | null;
  enabled: boolean;
  sourceType: AgentSkillSourceType;
  sourceManifest: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSkillDefinition = AgentSkillDefinitionSummary & {
  body: string;
  frontmatter: Record<string, unknown>;
  skillMd: string;
};

export type AgentSkillResourceSummary = {
  path: string;
  readable: boolean;
  sizeBytes?: number;
  type: "asset" | "metadata" | "reference" | "script" | "style" | "unknown";
};

export type SaveAgentSkillInput = {
  enabled: boolean;
  skillMd: string;
};

export type UpdateAgentSkillInput = Partial<SaveAgentSkillInput> & {
  skillId: string;
};

export type ImportAgentSkillZipInput = {
  enabled: boolean;
  fileName: string;
  zipBase64: string;
};

export async function loadAgentSkills() {
  const response = await fetch("/api/agent-skills", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skills: AgentSkillDefinitionSummary[] };
}

export async function loadAgentSkill(skillId: string) {
  const response = await fetch(`/api/agent-skills/${skillId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skill: AgentSkillDefinition };
}

export async function loadAgentSkillResources(skillId: string) {
  const response = await fetch(`/api/agent-skills/${skillId}/resources`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { resources: AgentSkillResourceSummary[] };
}

export function getAgentSkillResourceContentUrl(
  skillId: string,
  resourcePath: string
) {
  return `/api/agent-skills/${encodeURIComponent(
    skillId
  )}/resources/content?path=${encodeURIComponent(resourcePath)}`;
}

export async function loadAgentSkillResourceText(
  skillId: string,
  resourcePath: string
) {
  const response = await fetch(getAgentSkillResourceContentUrl(skillId, resourcePath), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return response.text();
}

export async function downloadAgentSkillSourcePackage(skill: AgentSkillDefinitionSummary) {
  const response = await fetch(`/api/agent-skills/${skill.id}/package`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${sanitizeDownloadName(skill.name)}.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createAgentSkill(input: SaveAgentSkillInput) {
  const response = await fetch("/api/agent-skills", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skill: AgentSkillDefinition };
}

export async function updateAgentSkill(input: UpdateAgentSkillInput) {
  const { skillId, ...body } = input;
  const response = await fetch(`/api/agent-skills/${skillId}`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skill: AgentSkillDefinition };
}

export async function importAgentSkillZip(input: ImportAgentSkillZipInput) {
  const response = await fetch("/api/agent-skills/import", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skill: AgentSkillDefinition };
}

export async function deleteAgentSkill(skillId: string) {
  const response = await fetch(`/api/agent-skills/${skillId}`, {
    credentials: "include",
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }
}

export async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const [, base64 = ""] = dataUrl.split(",", 2);
  if (!base64) {
    throw new Error("无法读取 zip 文件内容");
  }
  return base64;
}

function sanitizeDownloadName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "agent-skill"
  );
}
