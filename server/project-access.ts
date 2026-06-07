export type ProjectAccessCandidate = {
  userId: string | null;
  deletedAt: string | null;
};

export function canAccessProject(
  userId: string,
  project: ProjectAccessCandidate | null
) {
  return Boolean(project && project.userId === userId && !project.deletedAt);
}
