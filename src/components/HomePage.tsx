import { motion } from "framer-motion";
import { ChevronRightIcon as ChevronRight } from "@proicons/react";
import { useCallback, useRef, useState } from "react";

import { CucumberLogo } from "@/components/icons/cucumber-logo";
import {
  PROJECT_CARD_CLASS_NAME,
  PROJECT_CARD_META_CLASS_NAME,
  PROJECT_CARD_TITLE_CLASS_NAME,
  PROJECT_CREATE_CARD_CLASS_NAME,
} from "@/components/project-card-classnames";
import {
  ProjectCreateGlyph,
  ProjectPreview,
} from "@/components/ProjectCard";
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
    <div className="flex min-h-full flex-col items-center overflow-auto bg-cuc-surface px-6 pb-14 pt-[42px] text-cuc-text-strong max-[760px]:px-3 max-[760px]:pb-[78px] max-[760px]:pt-7">
      <motion.div
        initial="hidden"
        animate="visible"
        className="mt-[clamp(24px,9vh,86px)] grid w-[var(--cuc-width-home-composer)] justify-items-center text-center max-[760px]:mt-3 max-[760px]:w-full"
      >
        <motion.div
          variants={fadeUp}
          custom={0}
          className="mb-[18px] flex h-cuc-floating-height items-center gap-1 rounded-cuc-floating bg-cuc-surface/68 p-2 max-[760px]:w-full max-[760px]:justify-between"
        >
          <span className="inline-flex h-cuc-control items-center gap-[7px] rounded-cuc-control py-0 pl-1.5 pr-[9px] text-[13px] font-medium leading-5 text-cuc-ink">
            <CucumberLogo className="size-5" />
            <span>cucumber</span>
          </span>
          <span className="inline-flex h-cuc-control max-w-[180px] items-center overflow-hidden truncate rounded-cuc-control px-2.5 text-[13px] leading-5 text-cuc-text-secondary">
            你好，{user.username}
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          custom={1}
          className="m-0 text-[22px] font-semibold leading-[30px] text-cuc-text-strong max-[760px]:text-lg max-[760px]:leading-[26px]"
        >
          输入需求，让 Agent 帮你实现
        </motion.h1>
        <motion.p
          variants={fadeUp}
          custom={2}
          className="mb-[22px] mt-2 text-[13px] leading-5 text-cuc-text-muted max-[760px]:mb-[18px]"
        >
          从一个想法开始，进入可编辑的无限画布。
        </motion.p>

        <motion.div variants={fadeUp} custom={3} className="w-full">
          <HomePrompt onSubmit={onPromptSubmit} />
        </motion.div>
      </motion.div>

      <div className="mt-[54px] w-[var(--cuc-width-page)] max-[760px]:mt-9 max-[760px]:w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
          className="mb-3 flex h-cuc-control items-center justify-between"
        >
          <h2 className="m-0 text-sm font-medium leading-5 text-cuc-text">
            最近项目
          </h2>
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-cuc-control border-0 bg-transparent px-[12.5px] text-sm leading-[22px] text-cuc-text-muted hover:bg-cuc-surface/72 hover:text-cuc-text"
          >
            查看全部
            <ChevronRight size={14} />
          </button>
        </motion.div>

        <motion.div
          variants={cardStagger}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-4 gap-3 max-[760px]:grid-cols-2 max-[760px]:gap-2.5"
        >
          <motion.button
            variants={cardItem}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={onCreate}
            className={PROJECT_CREATE_CARD_CLASS_NAME}
          >
            <ProjectCreateGlyph />
            <span className={PROJECT_CARD_TITLE_CLASS_NAME}>新建项目</span>
            <span className={PROJECT_CARD_META_CLASS_NAME}>打开一张空白画布</span>
          </motion.button>

          {!loading &&
            recentProjects.map((project) => (
              <motion.button
                key={project.id}
                variants={cardItem}
                whileHover={{ y: -2 }}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className={PROJECT_CARD_CLASS_NAME}
              >
                <ProjectPreview projectId={project.id} />
                <span className={PROJECT_CARD_TITLE_CLASS_NAME}>{project.title}</span>
                <span className={PROJECT_CARD_META_CLASS_NAME}>
                  {project.nodeCount} 节点 · {project.imageCount} 图片 · 更新于{" "}
                  {formatDate(project.updatedAt)}
                </span>
              </motion.button>
            ))}
        </motion.div>

        {!loading && !recentProjects.length && (
          <div className="grid min-h-[92px] place-items-center rounded-cuc-card border-[0.5px] border-dashed border-cuc-preview-border bg-cuc-surface/42 text-[13px] leading-5 text-cuc-text-muted">
            还没有项目，点击「新建项目」开始吧。
          </div>
        )}
      </div>
    </div>
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
    <div className="grid min-h-cuc-composer-height w-full grid-cols-[minmax(0,1fr)_56px] items-center overflow-hidden rounded-cuc-composer border-[0.5px] border-cuc-border bg-cuc-surface focus-within:border-cuc-node-border-active">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="输入需求，让 Agent 生成图片..."
        rows={1}
        className="h-[52px] min-h-[52px] max-h-24 resize-none overflow-auto border-0 bg-transparent px-4 pb-[15px] pt-4 text-sm leading-5 text-cuc-text outline-0 placeholder:text-cuc-text-soft"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!hasContent}
        className="grid size-cuc-control cursor-pointer place-items-center justify-self-center rounded-cuc-control border-0 bg-cuc-control-dark text-cuc-surface disabled:cursor-default disabled:bg-cuc-node disabled:text-cuc-text-soft"
        aria-label="提交需求"
        title="提交需求"
      >
        <span aria-hidden="true" className="cucumber-send-icon" />
      </button>
    </div>
  );
}
