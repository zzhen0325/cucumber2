import { getResponseError } from "@/lib/api-client";

export type AgentSkillScope = "image";
export type AgentSkillPurpose = "prompt_expansion";
export type AgentSkillSourceType = "manual" | "seed" | "zip";

export type AgentSkillDefinitionSummary = {
  id: string;
  name: string;
  description: string;
  agentScope: AgentSkillScope;
  purpose: AgentSkillPurpose;
  enabled: boolean;
  isDefault: boolean;
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

export type SaveAgentSkillInput = {
  enabled: boolean;
  isDefault: boolean;
  skillMd: string;
};

export type UpdateAgentSkillInput = Partial<SaveAgentSkillInput> & {
  skillId: string;
};

export type ImportAgentSkillZipInput = {
  enabled: boolean;
  fileName: string;
  isDefault: boolean;
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
