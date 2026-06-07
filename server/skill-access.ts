export type SkillAccessRecord = {
  ownerUserId: string | null;
  deletedAt?: string | null;
};

export function canEditSkill(userId: string, skill: SkillAccessRecord | null) {
  return Boolean(skill && !skill.deletedAt && skill.ownerUserId === userId);
}
