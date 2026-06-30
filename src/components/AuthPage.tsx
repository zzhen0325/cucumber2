import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { FormEvent } from "react";

import { CucumberLogoInverted } from "@/components/icons/cucumber-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, register, type AppUser } from "@/lib/auth-storage";

type AuthPageProps = {
  onAuthenticated: (user: AppUser) => void;
};

type AuthMode = "login" | "register";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.12,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeIn = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

const LOGIN_FEATURES = [
  "用名称和密码继续你的 Agent Canvas",
  "把画布与工作区状态集中在一处",
  "从想法到交付，无需切换工具",
];

const REGISTER_FEATURES = [
  "创建一个专属的名称与密码账号",
  "随时回到你的工作区继续创作",
  "与已登录用户共享同一套工作区布局",
];

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response =
        mode === "login"
          ? await login({ username, password })
          : await register({ username, password });
      onAuthenticated(response.user);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setSubmitting(false);
    }
  };

  const isLogin = mode === "login";
  const features = isLogin ? LOGIN_FEATURES : REGISTER_FEATURES;

  return (
    <div className="flex min-h-screen bg-cuc-surface-warm">
      {/* Left panel — dark brand showcase (desktop only) */}
      <div className="relative hidden overflow-hidden bg-cuc-ink px-16 text-cuc-surface lg:flex lg:w-1/2 lg:flex-col lg:justify-center">
        <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[80%] w-[80%] rounded-full bg-cuc-surface/[0.03] blur-[100px]" />

        <motion.div initial="hidden" animate="visible" className="relative z-10">
          <motion.div
            variants={fadeUp}
            custom={0}
            className="mb-4 flex items-center gap-4"
          >
            <CucumberLogoInverted className="size-14" />
            <h1 className="text-4xl font-bold tracking-tight">cucumber</h1>
          </motion.div>

          <motion.p
            variants={fadeUp}
            custom={1}
            className="mb-3 text-3xl font-semibold tracking-tight"
          >
            {isLogin ? "欢迎回来" : "创建工作区账号"}
          </motion.p>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="mb-10 max-w-md text-lg text-cuc-surface/60"
          >
            {isLogin
              ? "登录后从你上次离开的地方继续。"
              : "用名称和密码注册，随时回到同一块画布。"}
          </motion.p>

          <ul className="space-y-4 text-sm text-cuc-surface/50">
            {features.map((text, index) => (
              <motion.li
                key={text}
                variants={fadeUp}
                custom={index + 3}
                className="flex items-start gap-3"
              >
                <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-cuc-surface" />
                {text}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>

      {/* Right panel — auth form */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full max-w-sm"
        >
          <motion.div
            key={mode}
            variants={stagger}
            initial="hidden"
            animate="visible"
            className="space-y-6"
          >
            <motion.div variants={fadeIn} className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold tracking-tight">
                {isLogin ? "进入项目" : "创建账号"}
              </h2>
              <p className="text-sm text-cuc-text-muted">
                用名称和密码继续你的 Agent Canvas
              </p>
            </motion.div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-cuc-card border border-cuc-danger-border bg-cuc-danger-surface px-4 py-3 text-sm text-cuc-danger-strong"
                  role="alert"
                  aria-live="polite"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.form
              variants={fadeIn}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="auth-username">名称</Label>
                <Input
                  id="auth-username"
                  autoComplete="username"
                  maxLength={80}
                  value={username}
                  onChange={(event) => setUsername(event.currentTarget.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auth-password">密码</Label>
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  maxLength={200}
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!username.trim() || !password || submitting}
              >
                {submitting
                  ? isLogin
                    ? "登录中..."
                    : "注册中..."
                  : isLogin
                    ? "登录"
                    : "注册"}
              </Button>
            </motion.form>

            <motion.p
              variants={fadeIn}
              className="text-center text-sm text-cuc-text-muted"
            >
              {isLogin ? "还没有账号？" : "已有账号？"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode((current) =>
                    current === "login" ? "register" : "login"
                  );
                  setError(null);
                }}
                className="font-medium text-cuc-text underline underline-offset-4"
              >
                {isLogin ? "创建一个" : "去登录"}
              </button>
            </motion.p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
