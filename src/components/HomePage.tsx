import { motion } from "framer-motion";
import { ChevronRightIcon as ChevronRight, AddIcon as Plus } from "@proicons/react";
import { useCallback, useRef, useState } from "react";

import { CucumberLogo } from "@/components/icons/cucumber-logo";
import type { AppUser } from "@/lib/auth-storage";
import type { ProjectSummary } from "@/lib/project-storage";
import { cn, formatDate } from "@/lib/utils";

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

const cardClassName =
  "grid aspect-[286/208] min-w-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-1.5 rounded-cuc-card border-[0.5px] border-cuc-border bg-cuc-surface p-2 text-left text-cuc-text shadow-none hover:border-[rgba(141,149,165,0.5)] max-[760px]:p-[7px]";
const cardTitleClassName =
  "truncate text-xs font-medium leading-4 text-cuc-text max-[760px]:text-[11px] max-[760px]:leading-[15px]";
const cardMetaClassName =
  "truncate text-[10px] leading-[13px] text-cuc-text-muted max-[760px]:text-[9px] max-[760px]:leading-3";

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
          </motion.button>

          {!loading &&
            recentProjects.map((project) => (
              <motion.button
                key={project.id}
                variants={cardItem}
                whileHover={{ y: -2 }}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className={cardClassName}
              >
                <ProjectPreview tone={previewTone(project.id)} />
                <span className={cardTitleClassName}>{project.title}</span>
                <span className={cardMetaClassName}>
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

function previewTone(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 4;
  }
  return hash;
}
