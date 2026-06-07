import {
  Check,
  FolderOpen,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { AppUser } from "@/lib/auth-storage";
import {
  createProject,
  deleteProject,
  loadProjects,
  updateProject,
  type ProjectSummary,
} from "@/lib/project-storage";

type ProjectListPageProps = {
  user: AppUser;
  onLogout: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
};

export function ProjectListPage({
  user,
  onLogout,
  onOpenProject,
}: ProjectListPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

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

  const handleCreateProject = async () => {
    setBusyAction("create");
    setError(null);

    try {
      const { project } = await createProject("Untitled");
      onOpenProject(project.id);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRename = async (
    event: FormEvent<HTMLFormElement>,
    projectId: string
  ) => {
    event.preventDefault();
    const title = editingTitle.trim();
    if (!title) {
      return;
    }

    setBusyAction(`rename:${projectId}`);
    setError(null);

    try {
      const { project } = await updateProject({ projectId, title });
      setProjects((current) =>
        current.map((item) =>
          item.id === projectId
            ? { ...item, title: project.title, updatedAt: project.updatedAt }
            : item
        )
      );
      setEditingProjectId(null);
      setEditingTitle("");
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteProject = async (project: ProjectSummary) => {
    if (!window.confirm(`删除「${project.title}」？`)) {
      return;
    }

    setBusyAction(`delete:${project.id}`);
    setError(null);

    try {
      await deleteProject(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = async () => {
    setBusyAction("logout");
    setError(null);

    try {
      await onLogout();
    } catch (nextError) {
      setError(getClientError(nextError));
      setBusyAction(null);
    }
  };

  return (
    <main className="projects-shell">
      <header className="projects-header">
        <div className="projects-brand">
          <div className="brand-mark">
            <Sparkles size={17} />
          </div>
          <div>
            <strong>项目</strong>
            <span>{user.username}</span>
          </div>
        </div>
        <div className="projects-actions">
          <button
            aria-label="新建项目"
            className="projects-primary-action"
            disabled={busyAction === "create"}
            onClick={handleCreateProject}
            title="新建项目"
            type="button"
          >
            {busyAction === "create" ? <Loader2 size={15} /> : <Plus size={15} />}
            新建
          </button>
          <button
            aria-label="退出登录"
            className="projects-icon-action"
            disabled={busyAction === "logout"}
            onClick={handleLogout}
            title="退出登录"
            type="button"
          >
            {busyAction === "logout" ? <Loader2 size={15} /> : <LogOut size={15} />}
          </button>
        </div>
      </header>

      {error && <div className="projects-error">{error}</div>}

      <section className="projects-list" aria-label="项目列表">
        {loading && (
          <div className="projects-empty">
            <Loader2 size={17} />
            <span>加载中</span>
          </div>
        )}

        {!loading && !projects.length && (
          <div className="projects-empty">
            <FolderOpen size={18} />
            <span>还没有项目</span>
          </div>
        )}

        {!loading &&
          projects.map((project) => {
            const isEditing = editingProjectId === project.id;
            const isRenaming = busyAction === `rename:${project.id}`;
            const isDeleting = busyAction === `delete:${project.id}`;

            return (
              <article className="project-card" key={project.id}>
                <button
                  aria-label={`打开${project.title}`}
                  className="project-open-hitarea"
                  onClick={() => onOpenProject(project.id)}
                  type="button"
                />

                <div className="project-card-main">
                  {isEditing ? (
                    <form
                      className="project-rename-form"
                      onSubmit={(event) => handleRename(event, project.id)}
                    >
                      <input
                        autoFocus
                        maxLength={120}
                        value={editingTitle}
                        onChange={(event) =>
                          setEditingTitle(event.currentTarget.value)
                        }
                      />
                      <button
                        aria-label="保存名称"
                        disabled={isRenaming || !editingTitle.trim()}
                        title="保存名称"
                        type="submit"
                      >
                        {isRenaming ? <Loader2 size={14} /> : <Check size={14} />}
                      </button>
                      <button
                        aria-label="取消重命名"
                        onClick={() => {
                          setEditingProjectId(null);
                          setEditingTitle("");
                        }}
                        title="取消重命名"
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </form>
                  ) : (
                    <h2 title={project.title}>{project.title}</h2>
                  )}
                  <p>
                    {project.nodeCount} 节点 · {project.imageCount} 图片 ·{" "}
                    {formatUpdatedAt(project.updatedAt)}
                  </p>
                </div>

                <div className="project-card-actions">
                  <button
                    aria-label="重命名项目"
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingProjectId(project.id);
                      setEditingTitle(project.title);
                    }}
                    title="重命名项目"
                    type="button"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    aria-label="删除项目"
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteProject(project);
                    }}
                    title="删除项目"
                    type="button"
                  >
                    {isDeleting ? <Loader2 size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
              </article>
            );
          })}
      </section>
    </main>
  );
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
