import { motion } from "framer-motion";
import {
  CheckmarkIcon as Check,
  PencilIcon as Pencil,
  AddIcon as Plus,
  DeleteIcon as Trash2,
  CancelIcon as X,
} from "@proicons/react";
import { useState } from "react";
import type { FormEvent } from "react";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import type { ProjectSummary } from "@/lib/project-storage";
import { cn, formatDate } from "@/lib/utils";

const cardItem = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const pageClassName =
  "min-h-full overflow-auto bg-cuc-canvas px-6 pb-14 pt-[42px] text-cuc-text-strong max-[760px]:h-[calc(100dvh-56px)] max-[760px]:min-h-0 max-[760px]:px-3 max-[760px]:pb-[78px] max-[760px]:pt-7";
const cardClassName =
  "grid aspect-[286/208] min-w-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-1.5 rounded-cuc-card border-[0.5px] border-cuc-border bg-cuc-surface p-2 text-left text-cuc-text shadow-none hover:border-[rgba(141,149,165,0.5)] max-[760px]:p-[7px]";
const cardTitleClassName =
  "truncate text-xs font-medium leading-4 text-cuc-text max-[760px]:text-[11px] max-[760px]:leading-[15px]";
const cardMetaClassName =
  "truncate text-[10px] leading-[13px] text-cuc-text-muted max-[760px]:text-[9px] max-[760px]:leading-3";
const iconButtonClassName =
  "grid size-7 cursor-pointer place-items-center rounded-cuc-image border-0 bg-cuc-surface/88 text-cuc-text-secondary hover:bg-cuc-surface-warm hover:text-cuc-text disabled:cursor-default disabled:opacity-[0.42]";

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
    <div className={pageClassName}>
      <div className="mx-auto w-[var(--cuc-width-page)] max-[760px]:w-full">
        <div className="mb-4 flex min-h-20 items-center justify-between gap-3 rounded-cuc-floating p-2 max-[760px]:items-start">
          <div>
            <h1 className="m-0 text-2xl font-medium leading-[30px] text-cuc-text">
              项目
            </h1>
            <p className="mb-0 mt-px text-[13px] leading-5 text-cuc-text-muted">
              管理你的画布工作区
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 min-w-0 items-center gap-2 rounded-cuc-control border-0 bg-cuc-ink px-[12.5px] text-sm font-normal leading-[22px] text-cuc-surface hover:bg-[#1a1a1a] disabled:cursor-default disabled:opacity-[0.42]"
            onClick={onCreate}
          >
            <Plus size={16} />
            新建
          </button>
        </div>

        <div className="grid grid-cols-5 gap-3 max-[760px]:grid-cols-2 max-[760px]:gap-2.5">
          <button
            type="button"
            onClick={onCreate}
            className={cn(
              cardClassName,
              "grid-rows-[auto_auto_auto] place-content-center justify-items-center text-center"
            )}
          >
            <span className="mb-0.5 grid size-cuc-tool place-items-center rounded-cuc-floating bg-cuc-node text-cuc-ink">
              <Plus size={18} />
            </span>
            <span className={cardTitleClassName}>新建项目</span>
            <span className={cardMetaClassName}>打开一张空白画布</span>
          </button>

          {!loading &&
            projects.map((project) => {
              const isEditing = editingProjectId === project.id;
              const isRenaming = busyAction === `rename:${project.id}`;

              return (
                <motion.div
                  key={project.id}
                  variants={cardItem}
                  className={cn(cardClassName, "group/project relative")}
                >
                  {!isEditing && (
                    <button
                      type="button"
                      aria-label={`打开 ${project.title}`}
                      onClick={() => onOpenProject(project.id)}
                      className="absolute inset-0 z-[2] cursor-pointer rounded-cuc-card border-0 bg-transparent"
                    />
                  )}

                  {!isEditing && (
                    <div className="absolute right-3.5 top-3.5 z-[3] flex gap-1 opacity-0 transition-opacity duration-[140ms] ease-in group-focus-within/project:opacity-100 group-hover/project:opacity-100 max-[760px]:opacity-100">
                      <button
                        type="button"
                        className={iconButtonClassName}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingProjectId(project.id);
                          setEditingTitle(project.title);
                        }}
                        aria-label={`重命名 ${project.title}`}
                        title="重命名"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClassName}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRequestDelete(project.id);
                        }}
                        aria-label={`删除 ${project.title}`}
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}

                  <ProjectPreview tone={previewTone(project.id)} />

                  {isEditing ? (
                    <form
                      className="relative z-[4] mt-px grid grid-cols-[minmax(0,1fr)_28px_28px] items-center gap-1"
                      onSubmit={(event) => submitRename(event, project.id)}
                    >
                      <input
                        autoFocus
                        maxLength={120}
                        className="h-7 min-w-0 rounded-cuc-card border-[0.5px] border-cuc-border bg-cuc-surface px-2 text-xs leading-4 text-cuc-text outline-0 focus:border-black/60"
                        value={editingTitle}
                        onChange={(event) =>
                          setEditingTitle(event.currentTarget.value)
                        }
                      />
                      <button
                        type="submit"
                        className={iconButtonClassName}
                        aria-label="保存名称"
                        disabled={isRenaming || !editingTitle.trim()}
                      >
                        {isRenaming ? (
                          <LoadingIndicator ariaLabel="保存名称中" size={13} />
                        ) : (
                          <Check size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        className={iconButtonClassName}
                        aria-label="取消重命名"
                        onClick={() => {
                          setEditingProjectId(null);
                          setEditingTitle("");
                        }}
                      >
                        <X size={13} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className={cardTitleClassName}>{project.title}</span>
                      <span className={cardMetaClassName}>
                        {project.nodeCount} 节点 · {project.edgeCount} 边 ·{" "}
                        {project.imageCount} 图片 · 更新于{" "}
                        {formatDate(project.updatedAt)}
                      </span>
                    </>
                  )}
                </motion.div>
              );
            })}
        </div>

        {!loading && !projects.length && (
          <div className="grid min-h-[92px] place-items-center rounded-cuc-card border-[0.5px] border-dashed border-cuc-preview-border bg-cuc-surface/42 text-[13px] leading-5 text-cuc-text-muted">
            还没有项目，点击「新建项目」开始吧。
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectPreview({ tone }: { tone: number }) {
  return (
    <span className="relative block min-h-0 overflow-hidden rounded-cuc-canvas border-[0.5px] border-cuc-canvas-border bg-cuc-canvas">
      <span className="absolute left-[37%] top-[37%] block h-px w-[31%] origin-left rotate-[13deg] border-t border-dashed border-cuc-edge" />
      <span className="absolute left-[43%] top-[61%] block h-px w-[28%] origin-left -rotate-[18deg] border-t border-dashed border-cuc-edge" />
      <span
        className={cn(
          "absolute left-[12%] top-[18%] block h-[22%] w-[31%] rounded-cuc-control-lg border-[0.5px] border-cuc-node-border bg-cuc-node",
          tone === 3 && "bg-[#f1f0e8]"
        )}
      />
      <span
        className={cn(
          "absolute right-[10%] top-[31%] block h-[26%] w-[34%] rounded-cuc-control-lg border-[0.5px] border-cuc-node-border bg-cuc-node",
          tone === 1 && "bg-[#eef2e8]"
        )}
      />
      <span
        className={cn(
          "absolute bottom-[15%] left-[29%] block h-[24%] w-[36%] rounded-cuc-control-lg border-[0.5px] border-cuc-node-border bg-cuc-node",
          tone === 2 && "bg-[#edf1f6]"
        )}
      />
    </span>
  );
}

function previewTone(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 4;
  }
  return hash;
}
