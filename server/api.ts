import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { serve } from "@hono/node-server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { z } from "zod";

import { isSeedreamConfigured } from "../seedream.ts";
import { executeAgentRun } from "./agent/index.ts";
import { getAgentModelConfiguration } from "./agent/model-config.ts";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  verifyPassword,
} from "./auth.ts";
import {
  claimUnownedProjects,
  createProject,
  createSession,
  createUser,
  deleteSession,
  getProjectForUser,
  getSessionUser,
  getUserByUsername,
  getUserCount,
  isSupabaseConfigured,
  listAgentEventsForUser,
  listProjects,
  softDeleteProject,
  updateProjectForUser,
  ProjectVersionConflictError,
  type AppUser,
} from "./supabase.ts";

loadServerEnv();

const app = new Hono();
const activeAgentRuns = new Map<string, AbortController>();
const sessionCookieName = "cucumber_session";

const authInputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const canvasContextSchema = z.object({
  prompt: z.string().trim().min(1),
  promptNodeId: z.string().nullable().optional(),
  selectedNodeId: z.string().nullable().optional(),
});

const projectCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled"),
});

const projectPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
    selectedNodeId: z.string().nullable().optional(),
    lastRunId: z.string().nullable().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No project updates provided.",
  });

app.use("*", cors());

app.onError((error, c) => {
  console.error("[api]", error);
  const apiError = getApiError(error);
  return c.json({ error: apiError.message }, 500);
});

app.get("/api/health", (c) => {
  const agent = getAgentModelConfiguration();
  return c.json({
    ok: true,
    agentConfigured: agent.configured,
    agentProvider: agent.provider,
    agentModel: agent.model,
    seedreamConfigured: isSeedreamConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
  });
});

app.post("/api/auth/register", async (c) => {
  const input = authInputSchema.parse(await c.req.json());
  const username = normalizeUsername(input.username);
  const existingUser = await getUserByUsername(username);

  if (existingUser) {
    return c.json({ error: "名称已存在" }, 409);
  }

  const usersBeforeCreate = await getUserCount();
  const user = await createUser({
    username,
    passwordHash: await hashPassword(input.password),
  });

  if (usersBeforeCreate === 0) {
    await claimUnownedProjects(user.id);
  }

  await startSession(c, user);
  return c.json({ user });
});

app.post("/api/auth/login", async (c) => {
  const input = authInputSchema.parse(await c.req.json());
  const username = normalizeUsername(input.username);
  const user = await getUserByUsername(username);

  if (!user || !(await verifyPassword(input.password, user.password_hash))) {
    return c.json({ error: "名称或密码不正确" }, 401);
  }

  const publicUser = {
    id: user.id,
    username: user.username,
    createdAt: user.created_at,
  } satisfies AppUser;

  await startSession(c, publicUser);
  return c.json({ user: publicUser });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, sessionCookieName);
  if (token) {
    await deleteSession(hashSessionToken(token));
  }

  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const user = await getOptionalUser(c);
  return c.json({ user });
});

app.get("/api/projects", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projects = await listProjects(user.id);
  return c.json({ projects });
});

app.post("/api/projects", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const input = projectCreateSchema.parse(await c.req.json());
  const project = await createProject(user.id, input.title);
  return c.json({ project });
});

app.get("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  return c.json({ project });
});

app.patch("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = projectPatchSchema.parse(await c.req.json());

  try {
    const project = await updateProjectForUser({
      projectId,
      userId: user.id,
      title: input.title,
      nodes: input.nodes as Parameters<typeof updateProjectForUser>[0]["nodes"],
      edges: input.edges as Parameters<typeof updateProjectForUser>[0]["edges"],
      selectedNodeId: input.selectedNodeId,
      lastRunId: input.lastRunId,
      expectedVersion: input.expectedVersion,
    });

    if (!project) {
      return notFound(c);
    }

    return c.json({ project });
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) {
      return c.json(
        { error: error.message, code: "version_conflict", project: error.project },
        409
      );
    }
    throw error;
  }
});

app.delete("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const deleted = await softDeleteProject(projectId, user.id);
  if (!deleted) {
    return notFound(c);
  }

  return c.json({ ok: true });
});

app.get("/api/projects/:projectId/runs/:runNodeId/trace", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const runNodeId = z.string().min(1).parse(c.req.param("runNodeId"));
  const events = await listAgentEventsForUser({
    projectId,
    runNodeId,
    userId: user.id,
  });

  if (!events) {
    return notFound(c);
  }

  return c.json({ events });
});

app.delete("/api/agent-run", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.query("projectId"));
  const runNodeId = z.string().min(1).parse(c.req.query("runNodeId"));
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  const controller = activeAgentRuns.get(
    getActiveAgentRunKey(user.id, projectId, runNodeId)
  );
  controller?.abort();
  return c.json({ stopped: Boolean(controller) });
});

app.post("/api/agent-run", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const canvasContext = canvasContextSchema.parse(body.canvasContext ?? {});
  const projectId = z.string().uuid().parse(body.projectId);
  const runNodeId = z.string().min(1).parse(body.runNodeId);
  const project = await getProjectForUser(projectId, user.id);

  if (!project) {
    return notFound(c);
  }

  const updatedProject = await updateProjectForUser({
    projectId,
    userId: user.id,
    lastRunId: runNodeId,
  });
  if (!updatedProject) {
    return notFound(c);
  }

  const activeRunKey = getActiveAgentRunKey(user.id, projectId, runNodeId);
  const controller = new AbortController();
  activeAgentRuns.set(activeRunKey, controller);
  const abortFromRequest = () => controller.abort(c.req.raw.signal.reason);
  c.req.raw.signal.addEventListener("abort", abortFromRequest, { once: true });

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      try {
        await executeAgentRun({
          canvasContext,
          projectId,
          projectSnapshot: updatedProject,
          runNodeId,
          signal: controller.signal,
          userId: user.id,
          writer,
        });
      } finally {
        c.req.raw.signal.removeEventListener("abort", abortFromRequest);
        if (activeAgentRuns.get(activeRunKey) === controller) {
          activeAgentRuns.delete(activeRunKey);
        }
      }
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
});

function getActiveAgentRunKey(
  userId: string,
  projectId: string,
  runNodeId: string
) {
  return `${userId}:${projectId}:${runNodeId}`;
}

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Cucumber Agent API listening on http://${info.address}:${info.port}`);
});

async function startSession(c: Context, user: AppUser) {
  const session = createSessionToken();

  await createSession({
    userId: user.id,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt.toISOString(),
  });

  setCookie(c, sessionCookieName, session.token, {
    expires: session.expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function getOptionalUser(c: Context) {
  const token = getCookie(c, sessionCookieName);
  if (!token) {
    return null;
  }

  const user = await getSessionUser(hashSessionToken(token));
  if (!user) {
    clearSessionCookie(c);
  }

  return user;
}

async function requireUser(c: Context) {
  return getOptionalUser(c);
}

function clearSessionCookie(c: Context) {
  deleteCookie(c, sessionCookieName, { path: "/" });
}

function unauthorized(c: Context) {
  clearSessionCookie(c);
  return c.json({ error: "请先登录" }, 401);
}

function notFound(c: Context) {
  return c.json({ error: "项目不存在" }, 404);
}

function loadServerEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      loadEnvFile(file);
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getApiError(error: unknown) {
  const message = getErrorMessage(error);
  const details = getErrorDetails(error);
  const combined = `${message}\n${details}`;

  if (
    combined.includes("agent_run_events") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Agent event 存储表未创建，请应用最新 Supabase migrations。",
    };
  }

  if (
    combined.includes("UNABLE_TO_GET_ISSUER_CERT_LOCALLY") ||
    combined.includes("SELF_SIGNED_CERT_IN_CHAIN") ||
    combined.includes("unable to get local issuer certificate")
  ) {
    return {
      message:
        "Supabase 证书校验失败，请用 pnpm dev:api 启动，或设置 NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem 后重启 API。",
    };
  }

  return { message };
}

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const details = "details" in error ? error.details : null;
  return typeof details === "string" ? details : "";
}
