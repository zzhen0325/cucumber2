import { motion } from "framer-motion";
import { ChevronRightIcon as ChevronRight, AddIcon as Plus } from "@proicons/react";
import { useCallback, useRef, useState } from "react";

import { CucumberLogo } from "@/components/icons/cucumber-logo";
import type { AppUser } from "@/lib/auth-storage";
import type { ProjectSummary } from "@/lib/project-storage";
import { formatDate } from "@/lib/utils";

/** Maximum number of recent projects shown on the home page. */
const RECENT_PROJECTS_LIMIT = 4;

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

const cardStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

const cardItem = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

type HomePageProps = {
  user: AppUser;
  projects: ProjectSummary[];
  loading: boolean;
  onCreate: () => void;
  onOpenProject: (projectId: string) => void;
  onPromptSubmit: (prompt: string) => void;
  onViewAll: () => void;
};

export function HomePage({
  user,
  projects,
  loading,
  onCreate,
  onOpenProject,
  onPromptSubmit,
  onViewAll,
}: HomePageProps) {
  const recentProjects = projects.slice(0, RECENT_PROJECTS_LIMIT);

  return (
    <div className="home-page">
      <motion.div
        initial="hidden"
        animate="visible"
        className="home-entry"
      >
        <motion.div
          variants={fadeUp}
          custom={0}
          className="home-topline"
        >
          <span className="home-brand">
            <CucumberLogo className="home-brand-logo" />
            <span>cucumber</span>
          </span>
          <span className="home-user">你好，{user.username}</span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          custom={1}
          className="home-title"
        >
          输入需求，让 Agent 帮你实现
        </motion.h1>
        <motion.p
          variants={fadeUp}
          custom={2}
          className="home-subtitle"
        >
          从一个想法开始，进入可编辑的无限画布。
        </motion.p>

        <motion.div variants={fadeUp} custom={3} className="w-full">
          <HomePrompt onSubmit={onPromptSubmit} />
        </motion.div>
      </motion.div>

      <div className="home-projects">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
          className="home-section-heading"
        >
          <h2>最近项目</h2>
          <button
            type="button"
            onClick={onViewAll}
            className="home-view-all"
          >
            查看全部
            <ChevronRight size={14} />
          </button>
        </motion.div>

        <motion.div
          variants={cardStagger}
          initial="hidden"
          animate="visible"
          className="home-project-grid"
        >
          <motion.button
            variants={cardItem}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={onCreate}
            className="home-project-card home-project-create"
          >
            <span className="home-create-icon">
              <Plus size={18} />
            </span>
            <span className="home-card-title">新建项目</span>
            <span className="home-card-meta">打开一张空白画布</span>
          </motion.button>

          {!loading &&
            recentProjects.map((project) => (
              <motion.button
                key={project.id}
                variants={cardItem}
                whileHover={{ y: -2 }}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className="home-project-card"
              >
                <ProjectPreview tone={previewTone(project.id)} />
                <span className="home-card-title">{project.title}</span>
                <span className="home-card-meta">
                  {project.nodeCount} 节点 · {project.imageCount} 图片 · 更新于{" "}
                  {formatDate(project.updatedAt)}
                </span>
              </motion.button>
            ))}
        </motion.div>

        {!loading && !recentProjects.length && (
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

function HomePrompt({ onSubmit }: { onSubmit: (prompt: string) => void }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasContent = value.trim().length > 0;

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [onSubmit, value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }, []);

  return (
    <div className="home-prompt">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="输入需求，让 Agent 生成图片..."
        rows={1}
        className="home-prompt-input"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!hasContent}
        className="home-prompt-submit"
        aria-label="提交需求"
        title="提交需求"
      >
        <span aria-hidden="true" className="cucumber-send-icon" />
      </button>
    </div>
  );
}

function previewTone(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 4;
  }
  return hash;
}
