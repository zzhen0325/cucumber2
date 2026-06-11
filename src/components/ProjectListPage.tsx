import { motion } from "framer-motion";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import type { ProjectSummary } from "@/lib/project-storage";
import { formatDate } from "@/lib/utils";

const cardItem = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

type ProjectListPageProps = {
  projects: ProjectSummary[];
  loading: boolean;
  busyAction: string | null;
  onCreate: () => void;
  onOpenProject: (projectId: string) => void;
  onRequestDelete: (projectId: string) => void;
  onRename: (projectId: string, title: string) => Promise<void>;
};

export function ProjectListPage({
  projects,
  loading,
  busyAction,
  onCreate,
  onOpenProject,
  onRequestDelete,
  onRename,
}: ProjectListPageProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const submitRename = async (
    event: FormEvent<HTMLFormElement>,
    projectId: string
  ) => {
    event.preventDefault();
    await onRename(projectId, editingTitle);
    setEditingProjectId(null);
    setEditingTitle("");
  };

  return (
    <div className="px-4 py-6 sm:px-6 md:p-8">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-base font-medium text-foreground sm:text-lg">项目</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* New project card */}
        <div
          role="button"
          tabIndex={0}
          onClick={onCreate}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onCreate();
            }
          }}
          className="aspect-[286/208] cursor-pointer rounded-xl bg-card p-2 shadow-card transition-all duration-300 hover:shadow-md sm:rounded-2xl sm:p-3"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted sm:gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 14 14"
              className="h-5 w-5 text-foreground sm:h-6 sm:w-6"
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M6.417 2.917a.583.583 0 0 1 1.166 0v3.5h3.5a.583.583 0 0 1 0 1.166h-3.5v3.5a.583.583 0 1 1-1.166 0v-3.5h-3.5a.583.583 0 1 1 0-1.166h3.5z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs font-semibold text-foreground sm:text-sm">
              新建项目
            </span>
          </div>
        </div>

        {!loading &&
          projects.map((project) => {
            const isEditing = editingProjectId === project.id;
            const isRenaming = busyAction === `rename:${project.id}`;

            return (
              <motion.div
                key={project.id}
                variants={cardItem}
                className="group relative block aspect-[286/208] rounded-lg bg-card p-2 shadow-card transition-all duration-300 hover:shadow-md sm:p-3"
              >
                {!isEditing && (
                  <button
                    type="button"
                    aria-label={`打开 ${project.title}`}
                    onClick={() => onOpenProject(project.id)}
                    className="absolute inset-0 z-0 cursor-pointer rounded-lg"
                  />
                )}

                {/* Action buttons -- hover reveal */}
                {!isEditing && (
                  <div className="absolute right-3 top-3 z-10 flex gap-1.5 opacity-0 transition-all duration-300 group-hover:opacity-100 sm:right-5 sm:top-5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingProjectId(project.id);
                        setEditingTitle(project.title);
                      }}
                      aria-label={`重命名 ${project.title}`}
                      className="flex size-8 items-center justify-center rounded-[4px] bg-foreground/70 text-background transition-colors hover:bg-foreground/80"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRequestDelete(project.id);
                      }}
                      aria-label={`删除 ${project.title}`}
                      className="flex size-8 items-center justify-center rounded-[4px] bg-foreground/70 text-background transition-colors hover:bg-foreground/80"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}

                {/* Thumbnail placeholder */}
                <div className="pointer-events-none aspect-[395/227] w-full overflow-hidden rounded-lg">
                  <div
                    className="h-full w-full"
                    style={{ background: placeholderGradient(project.id) }}
                  />
                </div>

                {/* Info */}
                {isEditing ? (
                  <form
                    className="relative z-10 mt-2 flex items-center gap-1 sm:mt-3"
                    onSubmit={(event) => submitRename(event, project.id)}
                  >
                    <input
                      autoFocus
                      maxLength={120}
                      value={editingTitle}
                      onChange={(event) =>
                        setEditingTitle(event.currentTarget.value)
                      }
                      className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring sm:text-sm"
                    />
                    <button
                      type="submit"
                      aria-label="保存名称"
                      disabled={isRenaming || !editingTitle.trim()}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      {isRenaming ? <Loader2 size={14} /> : <Check size={14} />}
                    </button>
                    <button
                      type="button"
                      aria-label="取消重命名"
                      onClick={() => {
                        setEditingProjectId(null);
                        setEditingTitle("");
                      }}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="pointer-events-none mt-2 flex items-center justify-between sm:mt-3">
                      <div className="truncate text-xs text-foreground sm:text-sm">
                        {project.title}
                      </div>
                    </div>
                    <div className="pointer-events-none mt-0.5 text-[10px] text-muted-foreground sm:text-[11px]">
                      {project.nodeCount} 节点 · {project.imageCount} 图片 · 更新于{" "}
                      {formatDate(project.updatedAt)}
                    </div>
                  </>
                )}
              </motion.div>
            );
          })}
      </div>

      {!loading && !projects.length && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          还没有项目，点击「新建项目」开始吧。
        </p>
      )}
    </div>
  );
}

/** Deterministic placeholder gradient derived from the project id. */
function placeholderGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  const a = hash;
  const b = (hash + 48) % 360;
  return `linear-gradient(135deg, hsl(${a} 55% 88%), hsl(${b} 50% 80%))`;
}
