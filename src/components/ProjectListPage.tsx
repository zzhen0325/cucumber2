import { motion } from "framer-motion";
import {
  CheckmarkIcon as Check,
  SpinnerIcon as Loader2,
  PencilIcon as Pencil,
  AddIcon as Plus,
  DeleteIcon as Trash2,
  CancelIcon as X,
} from "@proicons/react";
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
    <div className="project-page">
      <div className="workspace-page-inner">
        <div className="workspace-page-header">
          <div>
            <h1>项目</h1>
            <p>管理你的画布工作区</p>
          </div>
          <button type="button" className="workspace-primary-button" onClick={onCreate}>
            <Plus size={16} />
            新建
          </button>
        </div>

        <div className="project-grid">
          <button
            type="button"
            onClick={onCreate}
            className="home-project-card home-project-create"
          >
            <span className="home-create-icon">
              <Plus size={18} />
            </span>
            <span className="home-card-title">新建项目</span>
            <span className="home-card-meta">打开一张空白画布</span>
          </button>

          {!loading &&
            projects.map((project) => {
              const isEditing = editingProjectId === project.id;
              const isRenaming = busyAction === `rename:${project.id}`;

              return (
                <motion.div
                  key={project.id}
                  variants={cardItem}
                  className="home-project-card project-card"
                >
                  {!isEditing && (
                    <button
                      type="button"
                      aria-label={`打开 ${project.title}`}
                      onClick={() => onOpenProject(project.id)}
                      className="project-card-open"
                    />
                  )}

                  {!isEditing && (
                    <div className="project-card-actions">
                      <button
                        type="button"
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
                      className="project-rename-form"
                      onSubmit={(event) => submitRename(event, project.id)}
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
                        type="submit"
                        aria-label="保存名称"
                        disabled={isRenaming || !editingTitle.trim()}
                      >
                        {isRenaming ? <Loader2 size={13} /> : <Check size={13} />}
                      </button>
                      <button
                        type="button"
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
                      <span className="home-card-title">{project.title}</span>
                      <span className="home-card-meta">
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
          <div className="home-empty">
            还没有项目，点击「新建项目」开始吧。
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectPreview({ tone }: { tone: number }) {
  return (
    <span className="home-project-preview" data-tone={tone}>
      <span className="home-preview-edge home-preview-edge-a" />
      <span className="home-preview-edge home-preview-edge-b" />
      <span className="home-preview-node home-preview-node-a" />
      <span className="home-preview-node home-preview-node-b" />
      <span className="home-preview-node home-preview-node-c" />
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
