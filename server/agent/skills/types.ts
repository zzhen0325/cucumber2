import type {
  AgentSkillBindings,
  AgentSkillPurpose,
  AgentSkillScope,
  AgentSkillScriptManifest,
  AgentSkillTriggers,
} from "./skill-parser.ts";

export type AgentSkillScriptSummary = Omit<AgentSkillScriptManifest, "path"> & {
  path?: string;
};

export type AgentSkillCard = {
  id: string;
  name: string;
  description: string;
  agentScope: AgentSkillScope;
  purpose: AgentSkillPurpose;
  tags: string[];
  triggers: AgentSkillTriggers;
  bindings: AgentSkillBindings;
  scripts: AgentSkillScriptSummary[];
  sourceManifest: Record<string, unknown>;
  score: number;
  reasons: string[];
};

export type ActivatedAgentSkill = Omit<AgentSkillCard, "scripts"> & {
  body: string;
  frontmatter: Record<string, unknown>;
  packageBucket: string | null;
  packagePath: string | null;
  packageSha256: string | null;
  packageSizeBytes: number | null;
  scripts: AgentSkillScriptManifest[];
  skillMd: string;
};

export const MAX_ACTIVATED_SKILLS_PER_RUN = 3;
