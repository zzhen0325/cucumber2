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
  isDefault: boolean;
  score: number;
  reasons: string[];
};
