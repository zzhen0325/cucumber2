import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { serve } from "@hono/node-server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  generateSeedreamImage,
  inferSeedreamResultCount,
  isSeedreamConfigured,
  readSeedreamMaxOutputImagesFromEnv,
} from "../seedream.ts";
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
  listProjects,
  recordRunEvent,
  softDeleteProject,
  updateProjectForUser,
  type AppUser,
} from "./supabase.ts";

loadServerEnv();

const app = new Hono();
const sessionCookieName = "cucumber_session";

const authInputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const upstreamContextSchema = z.object({
  nodeId: z.string(),
  type: z.enum(["prompt", "image"]),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  summary: z.string().optional(),
});

const canvasContextSchema = z.object({
  prompt: z.string(),
  selectedNodeId: z.string().nullable().optional(),
  upstreamContext: z.array(upstreamContextSchema).default([]),
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
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No project updates provided.",
  });

app.use("*", cors());

app.onError((error, c) => {
  console.error("[api]", error);
  return c.text(getErrorMessage(error), 500);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    seedreamConfigured: isSeedreamConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
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
  const project = await updateProjectForUser({
    projectId,
    userId: user.id,
    title: input.title,
    nodes: input.nodes as Parameters<typeof updateProjectForUser>[0]["nodes"],
    edges: input.edges as Parameters<typeof updateProjectForUser>[0]["edges"],
    selectedNodeId: input.selectedNodeId,
    lastRunId: input.lastRunId,
  });

  if (!project) {
    return notFound(c);
  }

  return c.json({ project });
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

  const toolInput = {
    prompt: canvasContext.prompt,
    selectedNodeId: canvasContext.selectedNodeId ?? null,
    upstreamContext: canvasContext.upstreamContext,
    resultCount: inferSeedreamResultCount(
      canvasContext.prompt,
      readSeedreamMaxOutputImagesFromEnv()
    ),
  };

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const toolCallId = `generate_image-${crypto.randomUUID()}`;

      await recordRunEvent({
        projectId,
        runNodeId,
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: canvasContext.upstreamContext,
        status: "running",
        toolInput,
      });

      const agentText = streamText({
        model: getDeepSeekModel(),
        system:
          "你是 Cucumber infinite canvas 的图片生成 agent。只输出给用户看的执行文字，使用简短中文。不要说图片已经生成，不要编造工具结果，不要输出 Markdown 标题或列表。",
        prompt: buildAgentRunTextPrompt(canvasContext, toolInput.resultCount),
      });

      for await (const chunk of agentText.toUIMessageStream()) {
        writer.write(chunk);
      }

      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "generate_image",
        input: toolInput,
      });

      try {
        const output = await generateSeedreamImage(toolInput);

        await recordRunEvent({
          projectId,
          runNodeId,
          prompt: canvasContext.prompt,
          selectedNodeId: canvasContext.selectedNodeId ?? null,
          upstreamContext: canvasContext.upstreamContext,
          status: "success",
          toolInput,
          toolOutput: output,
        });

        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
      } catch (error) {
        const errorText = getErrorMessage(error);
        console.error("[agent-run]", error);

        await recordRunEvent({
          projectId,
          runNodeId,
          prompt: canvasContext.prompt,
          selectedNodeId: canvasContext.selectedNodeId ?? null,
          upstreamContext: canvasContext.upstreamContext,
          status: "error",
          toolInput,
          errorText,
        });

        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText,
        });
      }
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

function getDeepSeekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required.");
  }

  return createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    apiKey,
  }).chatModel(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
}

function buildAgentRunTextPrompt(
  canvasContext: z.infer<typeof canvasContextSchema>,
  resultCount: number
) {
  const upstreamSummary = canvasContext.upstreamContext.length
    ? canvasContext.upstreamContext
        .map((item, index) => {
          const summary =
            item.summary ?? item.prompt ?? (item.type === "image" ? "图片结果" : "提示词");
          return `${index + 1}. ${item.type}: ${summary}`;
        })
        .join("\n")
    : "无";

  return [
    `当前需求: ${canvasContext.prompt}`,
    `选中节点: ${canvasContext.selectedNodeId ?? "无"}`,
    `上游上下文:\n${upstreamSummary}`,
    `目标输出: ${resultCount} 张图片`,
    "请输出 1 到 3 句执行说明，说明你会如何理解需求并使用上游上下文。",
  ].join("\n\n");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
