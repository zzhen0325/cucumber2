import { useCallback, useEffect, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { CanvasWorkspace } from "@/components/CanvasWorkspace";
import { AuthPage } from "@/components/AuthPage";
import { LoadingScreen } from "@/components/LoadingScreen";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { getCurrentUser, logout, type AppUser } from "@/lib/auth-storage";


type SessionStatus = "loading" | "ready" | "error";

function App() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [projectId, setProjectId] = useState(() => getProjectIdFromUrl());

  useEffect(() => {
    let ignore = false;

    getCurrentUser()
      .then(({ user: nextUser }) => {
        if (ignore) {
          return;
        }

        setUser(nextUser);
        setSessionStatus("ready");
        setSessionError(null);
      })
      .catch((error: unknown) => {
        if (ignore) {
          return;
        }

        setSessionStatus("error");
        setSessionError(getClientError(error));
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setProjectId(getProjectIdFromUrl());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openProject = useCallback((nextProjectId: string) => {
    writeProjectIdToUrl(nextProjectId);
    setProjectId(nextProjectId);
  }, []);

  const closeProject = useCallback(() => {
    writeProjectIdToUrl(null);
    setProjectId(null);
  }, []);

  const handleAuthenticated = useCallback((nextUser: AppUser) => {
    setUser(nextUser);
    setSessionStatus("ready");
    setSessionError(null);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    closeProject();
    setUser(null);
  }, [closeProject]);

  return (
    <TooltipProvider>
      {sessionStatus === "loading" && (
        <LoadingScreen />
      )}

      {sessionStatus === "error" && (
        <main className="grid min-h-screen w-screen place-content-center gap-3 bg-cuc-surface-warm text-center text-[13px] text-cuc-text-muted">
          <div className="mx-auto size-cuc-toolbar-button rounded-cuc-round bg-cuc-danger shadow-[0_4px_16px_rgba(0,0,0,0.18)]" />
          <span>{sessionError ?? "连接失败"}</span>
        </main>
      )}

      {sessionStatus === "ready" && !user && (
        <AuthPage onAuthenticated={handleAuthenticated} />
      )}

      {sessionStatus === "ready" && user && projectId && (
        <CanvasWorkspace key={projectId} projectId={projectId} onBack={closeProject} />
      )}

      {sessionStatus === "ready" && user && !projectId && (
        <WorkspaceShell
          user={user}
          onLogout={handleLogout}
          onOpenProject={openProject}
        />
      )}
    </TooltipProvider>
  );
}

function getProjectIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("project");
}

function writeProjectIdToUrl(projectId: string | null) {
  const url = new URL(window.location.href);
  if (projectId) {
    url.searchParams.set("project", projectId);
  } else {
    url.searchParams.delete("project");
  }

  window.history.pushState({}, "", url);
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
