import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  login,
  register,
  type AppUser,
} from "@/lib/auth-storage";

type AuthPageProps = {
  onAuthenticated: (user: AppUser) => void;
};

type AuthMode = "login" | "register";

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

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-label="登录">
        <div className="auth-brand">
          <div className="brand-mark">
            <Sparkles size={17} />
          </div>
          <span>Cucumber</span>
        </div>

        <div className="auth-copy">
          <h1>{mode === "login" ? "进入项目" : "创建账号"}</h1>
          <p>用名称和密码继续你的 Agent Canvas。</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>名称</span>
            <input
              autoComplete="username"
              maxLength={80}
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={200}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button
            className="auth-submit"
            disabled={!username.trim() || !password || submitting}
            type="submit"
          >
            {submitting ? <Loader2 size={15} /> : <ArrowRight size={15} />}
            {mode === "login" ? "登录" : "注册"}
          </button>
        </form>

        <button
          className="auth-switch"
          onClick={() => {
            setMode((current) => (current === "login" ? "register" : "login"));
            setError(null);
          }}
          type="button"
        >
          {mode === "login" ? "创建新账号" : "已有账号，去登录"}
        </button>
      </section>
    </main>
  );
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
