import { getResponseError } from "@/lib/api-client";

export type SkillSummary = {
  id: string;
  ownerUserId: string | null;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
  isPublic: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SkillUpdateInput = {
  skillId: string;
  name?: string;
  description?: string;
  instructions?: string;
};

export async function loadSkills() {
  const response = await fetch("/api/skills", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skills: SkillSummary[] };
}

export async function uploadSkill(file: File) {
  const body = new FormData();
  body.set("file", file);

  const response = await fetch("/api/skills", {
    body,
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }

  return (await response.json()) as { skill: SkillSummary };
}

export async function updateSkill(input: SkillUpdateInput) {
  const { skillId, ...body } = input;
  const response = await fetch(`/api/skills/${skillId}`, {
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

  return (await response.json()) as { skill: SkillSummary };
}

export async function deleteSkill(skillId: string) {
  const response = await fetch(`/api/skills/${skillId}`, {
    credentials: "include",
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response));
  }
}
