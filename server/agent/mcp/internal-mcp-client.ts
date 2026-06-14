import { MCPServerStreamableHttp } from "@openai/agents";

import type { CucumberAgentContext } from "../context.ts";
import { getInternalMcpAuthorizationHeader } from "./internal-auth.ts";

let connectPromise: Promise<void> | null = null;
let cucumberInternalMcpServer: MCPServerStreamableHttp | null = null;

export function getCucumberInternalMcpServer() {
  if (!cucumberInternalMcpServer) {
    cucumberInternalMcpServer = new MCPServerStreamableHttp({
      cacheToolsList: true,
      errorFunction: null,
      name: "cucumber-internal-tools",
      timeout: 120_000,
      requestInit: {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: getInternalMcpAuthorizationHeader(),
        },
      },
      toolFilter: {
        allowedToolNames: ["generate_image"],
      },
      toolMetaResolver: ({ runContext }) => {
        const context = runContext.context as CucumberAgentContext;
        if (!context.mcpRunContextId) {
          return null;
        }
        return {
          cucumberRunContextId: context.mcpRunContextId,
        };
      },
      url: getInternalMcpUrl(),
    });
  }

  return cucumberInternalMcpServer;
}

export async function ensureCucumberInternalMcpConnected() {
  if (!connectPromise) {
    connectPromise = getCucumberInternalMcpServer()
      .connect()
      .catch((error) => {
        connectPromise = null;
        throw error;
      });
  }
  await connectPromise;
}

function getInternalMcpUrl() {
  return (
    process.env.CUCUMBER_INTERNAL_MCP_URL ??
    `http://127.0.0.1:${process.env.API_PORT ?? 8787}/internal/mcp`
  );
}
