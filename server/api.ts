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
import {
  getDefaultModelProviderId,
  getModelProviderSummaries,
  isArkConfigured,
  modelProviderIds,
} from "./model-providers.ts";
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
  createSkill,
  createUser,
  deleteSession,
  getProjectForUser,
  getSessionUser,
  getUserByUsername,
  getUserCount,
  isSupabaseConfigured,
  listRunStepEventsForUser,
  listPublicSkillsForUser,
  listProjects,
  softDeleteSkillForUser,
  updateSkillForUser,
  softDeleteProject,
  updateProjectForUser,
  ProjectVersionConflictError,
  type AppUser,
} from "./supabase.ts";
import { parseSkillZip } from "./skill-parser.ts";
import { executeOpenAIAgentsRunV2 } from "./agent-v2/index.ts";
import { executeAgentRun } from "./runtime/executor.ts";

loadServerEnv();

const app = new Hono();
const sessionCookieName = "cucumber_session";

const authInputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const upstreamContextSchema = z.object({
  nodeId: z.string(),
  type: z.enum([
    "prompt",
    "image",
    "artifact",
    "decision",
    "memory",
    "tool_result",
    "doc",
    "code",
    "webpage",
    "dataset",
  ]),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  summary: z.string().optional(),
  title: z.string().optional(),
  contentRef: z.string().optional(),
  priority: z.number().optional(),
  artifact: z
    .object({
      id: z.string(),
      type: z.string(),
      uri: z.string().optional(),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      contentRef: z.string().optional(),
    })
    .optional(),
});

const canvasContextSchema = z.object({
  prompt: z.string(),
  promptNodeId: z.string().nullable().optional(),
  selectedNodeId: z.string().nullable().optional(),
  upstreamContext: z.array(upstreamContextSchema).default([]),
  contextTrace: z
    .object({
      selectedNodeId: z.string().nullable().optional(),
      budget: z.number().optional(),
      omittedContextReason: z.string().optional(),
      omittedNodeIds: z.array(z.string()).optional(),
    })
    .optional(),
});
const modelProviderSchema = z.enum(modelProviderIds);

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

const skillPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    instructions: z.string().trim().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No skill updates provided.",
  });

app.use("*", cors());

app.onError((error, c) => {
  console.error("[api]", error);
  const apiError = getApiError(error);
  return c.json({ error: apiError.message }, 500);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    arkConfigured: isArkConfigured(),
    seedreamConfigured: isSeedreamConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    modelProviders: getModelProviderSummaries(),
    defaultModelProvider: getDefaultModelProviderId(),
  })
);

app.get("/api/model-providers", (c) =>
  c.json({
    defaultProvider: getDefaultModelProviderId(),
    providers: getModelProviderSummaries(),
  })
);

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
  const events = await listRunStepEventsForUser({
    projectId,
    runNodeId,
    userId: user.id,
  });

  if (!events) {
    return notFound(c);
  }

  return c.json({ events });
});

app.get("/api/skills", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skills = await listPublicSkillsForUser(user.id);
  return c.json({ skills });
});

app.post("/api/skills", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!isUploadedFile(file)) {
    return c.json({ error: "请上传 skill zip 文件" }, 400);
  }
  if (!file.name.endsWith(".zip")) {
    return c.json({ error: "Skill 文件必须是 .zip" }, 400);
  }

  let parsed: Awaited<ReturnType<typeof parseSkillZip>>;
  try {
    parsed = await parseSkillZip(await file.arrayBuffer());
  } catch (error) {
    return c.json({ error: getErrorMessage(error) }, 400);
  }

  const skill = await createSkill({
    ownerUserId: user.id,
    name: parsed.name,
    slug: parsed.slug,
    description: parsed.description,
    instructions: parsed.instructions,
    config: parsed.config,
    sourceManifest: parsed.sourceManifest,
  });

  return c.json({ skill });
});

app.patch("/api/skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const input = skillPatchSchema.parse(await c.req.json());
  const skill = await updateSkillForUser({
    skillId,
    userId: user.id,
    name: input.name,
    description: input.description,
    instructions: input.instructions,
  });

  if (!skill) {
    return c.json({ error: "无权编辑此 skill" }, 403);
  }

  return c.json({ skill });
});

app.delete("/api/skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const deleted = await softDeleteSkillForUser(skillId, user.id);
  if (!deleted) {
    return c.json({ error: "无权删除此 skill" }, 403);
  }

  return c.json({ ok: true });
});

app.post("/api/agent-run", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const canvasContext = canvasContextSchema.parse(body.canvasContext ?? {});
  const attachments = z.array(z.unknown()).default([]).parse(body.attachments);
  const modelProvider = modelProviderSchema
    .default(getDefaultModelProviderId())
    .parse(body.modelProvider);
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

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      await executeAgentRun({
        canvasContext,
        attachments,
        messages,
        modelProvider,
        projectId,
        projectSnapshot: updatedProject,
        runNodeId,
        userId: user.id,
        writer,
      });
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
});

app.post("/api/agent-run-v2", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const canvasContext = canvasContextSchema.parse(body.canvasContext ?? {});
  const attachments = z.array(z.unknown()).default([]).parse(body.attachments);
  const modelProvider = modelProviderSchema
    .default(getDefaultModelProviderId())
    .parse(body.modelProvider);
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

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      await executeOpenAIAgentsRunV2({
        canvasContext,
        attachments,
        messages,
        modelProvider,
        projectId,
        projectSnapshot: updatedProject,
        runNodeId,
        userId: user.id,
        writer,
      });
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
});

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

type UploadedFileLike = {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isUploadedFile(value: unknown): value is UploadedFileLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      "name" in value &&
      typeof value.name === "string"
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getApiError(error: unknown) {
  const message = getErrorMessage(error);
  const details = getErrorDetails(error);
  const combined = `${message}\n${details}`;

  if (
    combined.includes("agent_skills") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Skill 存储表未创建，请先应用 supabase/migrations/20260607002000_agent_skills.sql。",
    };
  }

  if (
    combined.includes("agent_run_step_events") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Run step event 存储表未创建，请先应用 supabase/migrations/20260608003000_agent_run_step_events.sql。",
    };
  }

  if (
    (combined.includes("agent_runs") || combined.includes("agent_run_steps")) &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Agent Runtime 存储表未创建，请先应用 supabase/migrations/20260608005000_agent_runtime_core.sql。",
    };
  }

  if (
    combined.includes("agent_artifacts") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Artifact 存储表未创建，请先应用 supabase/migrations/20260608004000_agent_artifacts.sql。",
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
