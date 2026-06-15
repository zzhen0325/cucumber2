import { motion } from "framer-motion";
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
    <div className="flex h-full bg-white flex-col items-center overflow-auto px-5 py-10 sm:px-8 md:py-16 lg:py-20">
      {/* Hero */}
      <motion.div
        initial="hidden"
        animate="visible"
        className="flex w-full max-w-2xl flex-col items-center text-center"
      >
        <motion.div
          variants={fadeUp}
          custom={0}
          className="mb-5 flex items-center gap-2 md:mb-6"
        >
          <CucumberLogo className="size-7 text-foreground md:size-8" />
          <span className="text-lg font-semibold tracking-tight text-foreground md:text-xl">
            cucumber
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          custom={1}
          className="mb-2 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl md:mb-3"
        >
          你好，{user.username}
        </motion.h1>
        <motion.p
          variants={fadeUp}
          custom={2}
          className="mb-8 text-sm tracking-[-0.01em] text-muted-foreground sm:text-base md:mb-10"
        >
          你的 AI 设计助手，从想法到作品
        </motion.p>

        <motion.div variants={fadeUp} custom={3} className="w-full">
          <HomePrompt onSubmit={onPromptSubmit} />
        </motion.div>
      </motion.div>

      {/* Recent projects */}
      <div className="mt-12 w-full max-w-5xl sm:mt-14 md:mt-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
          className="mb-4 flex items-center justify-between md:mb-5"
        >
          <h2 className="text-base font-medium tracking-tight text-foreground sm:text-lg">
            最近项目
          </h2>
          <button
            type="button"
            onClick={onViewAll}
            className="flex min-h-[44px] items-center gap-1 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:text-base"
          >
            查看全部
            <span className="flex h-6 w-6 -rotate-90 items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 13 8"
                className="h-[6px] w-[10px]"
              >
                <path stroke="currentColor" d="m1 .657 5.657 5.657L12.314.657" />
              </svg>
            </span>
          </button>
        </motion.div>

        <motion.div
          variants={cardStagger}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          {/* New project card */}
          <motion.button
            variants={cardItem}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={onCreate}
            className="aspect-[286/208] cursor-pointer rounded-2xl border border-border bg-card p-2 transition-colors duration-300 hover:border-primary/40 hover:bg-muted/40 sm:p-3"
          >
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted/60 sm:gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 14 14"
                  className="h-5 w-5"
                >
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M6.417 2.917a.583.583 0 0 1 1.166 0v3.5h3.5a.583.583 0 0 1 0 1.166h-3.5v3.5a.583.583 0 1 1-1.166 0v-3.5h-3.5a.583.583 0 1 1 0-1.166h3.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <span className="text-xs font-medium tracking-tight text-foreground sm:text-sm">
                新建项目
              </span>
            </div>
          </motion.button>

          {!loading &&
            recentProjects.map((project) => (
              <motion.button
                key={project.id}
                variants={cardItem}
                whileHover={{ y: -4 }}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className="group relative aspect-[286/208] cursor-pointer rounded-2xl bg-card p-3.5 text-left transition-shadow duration-300 hover:shadow-card"
              >
                <div className="aspect-[395/227] w-full overflow-hidden rounded-xl">
                  <div
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                    style={{ background: placeholderGradient(project.id) }}
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between sm:mt-3">
                  <div className="truncate text-xs font-medium tracking-tight text-foreground sm:text-sm">
                    {project.title}
                  </div>
                </div>
                <div className="mt-1 text-[10px] tracking-tight text-muted-foreground sm:text-[11px]">
                  {project.nodeCount} 节点 · {project.imageCount} 图片 · 更新于{" "}
                  {formatDate(project.updatedAt)}
                </div>
              </motion.button>
            ))}
        </motion.div>
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
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-colors focus-within:border-primary/50">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="让 cucumber 帮你设计..."
        rows={2}
        className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm leading-relaxed tracking-tight text-foreground placeholder:text-muted-foreground focus:outline-none sm:px-5 sm:pt-5"
      />

      <div className="flex items-center justify-end px-3 pb-3 sm:px-4 sm:pb-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasContent}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
            hasContent
              ? "bg-primary text-primary-foreground hover:bg-primary/80 hover:accent-glow active:bg-primary/90"
              : "cursor-not-allowed bg-muted text-muted-foreground"
          }`}
        >
          <svg
            className="h-[14px] w-[14px]"
            viewBox="0 0 24 24"
            fill="currentColor"
            role="img"
            aria-label="提交"
          >
            <path d="M11.293 3.293a1 1 0 0 1 1.414 0l8 8a1 1 0 0 1-1.414 1.414L13 6.414V20a1 1 0 1 1-2 0V6.414l-6.293 6.293a1 1 0 0 1-1.414-1.414z" />
          </svg>
        </button>
      </div>
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
