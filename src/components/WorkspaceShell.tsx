import { useCallback, useEffect, useState } from "react";

import { DeleteProjectDialog } from "@/components/DeleteProjectDialog";
import { HomePage } from "@/components/HomePage";
import { ProjectListPage } from "@/components/ProjectListPage";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AppSidebar, type WorkspaceView } from "@/components/AppSidebar";
import { SkillsPage } from "@/components/SkillsPage";
import type { AppUser } from "@/lib/auth-storage";
import {
  createProject,
  deleteProject,
  loadProjects,
  updateProject,
  type ProjectSummary,
} from "@/lib/project-storage";

type WorkspaceShellProps = {
  user: AppUser;
  onLogout: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
};

export function WorkspaceShell({
  user,
  onLogout,
  onOpenProject,
}: WorkspaceShellProps) {
  const [view, setView] = useState<WorkspaceView>("home");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let ignore = false;

    loadProjects()
      .then(({ projects: nextProjects }) => {
        if (ignore) {
          return;
        }
        setProjects(nextProjects);
      })
      .catch((nextError: unknown) => {
        if (ignore) {
          return;
        }
        setError(getClientError(nextError));
      })
      .finally(() => {
        if (ignore) {
          return;
        }
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const handleCreateProject = useCallback(async () => {
    setCreating(true);
    setError(null);

    try {
      const { project } = await createProject("Untitled");
      onOpenProject(project.id);
    } catch (nextError) {
      setError(getClientError(nextError));
      setCreating(false);
    }
  }, [onOpenProject]);

  const handleRename = useCallback(async (projectId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    setBusyAction(`rename:${projectId}`);
    setError(null);

    try {
      const { project } = await updateProject({ projectId, title: trimmed });
      setProjects((current) =>
        current.map((item) =>
          item.id === projectId
            ? { ...item, title: project.title, updatedAt: project.updatedAt }
            : item
        )
      );
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const requestDelete = useCallback((projectId: string) => {
    setPendingDeleteId(projectId);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    setPendingDeleteId(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await deleteProject(pendingDeleteId);
      setProjects((current) =>
        current.filter((item) => item.id !== pendingDeleteId)
      );
      setPendingDeleteId(null);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setDeleting(false);
    }
  }, [pendingDeleteId]);

  const handlePromptSubmit = useCallback(() => {
    void handleCreateProject();
  }, [handleCreateProject]);

  if (creating) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-canvas md:flex-row">
      <AppSidebar view={view} onViewChange={setView} onLogout={onLogout} />

      <main className="relative flex-1 overflow-auto pb-14 md:pb-0">
        {error && (
          <div className="absolute inset-x-0 top-0 z-20 bg-danger-surface px-6 py-2 text-center text-sm text-danger-strong">
            {error}
          </div>
        )}

        {view === "home" ? (
          <HomePage
            user={user}
            projects={projects}
            loading={loading}
            onCreate={handleCreateProject}
            onOpenProject={onOpenProject}
            onPromptSubmit={handlePromptSubmit}
            onViewAll={() => setView("projects")}
          />
        ) : view === "projects" ? (
          <ProjectListPage
            projects={projects}
            loading={loading}
            busyAction={busyAction}
            onCreate={handleCreateProject}
            onOpenProject={onOpenProject}
            onRequestDelete={requestDelete}
            onRename={handleRename}
          />
        ) : (
          <SkillsPage />
        )}
      </main>

      <DeleteProjectDialog
        open={pendingDeleteId !== null}
        deleting={deleting}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
