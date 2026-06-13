import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  executeGenerateImageTool,
  generateImageToolDescription,
} from "../tools/image/generate-image.tool.ts";
import { getMcpRunContext } from "./context-registry.ts";
import { isAuthorizedInternalMcpRequest } from "./internal-auth.ts";

const cucumberRunContextMetaKey = "cucumberRunContextId";

export async function handleInternalMcpRequest(request: Request) {
  if (!isAuthorizedInternalMcpRequest(request)) {
    return Response.json({ error: "Unauthorized internal MCP request." }, { status: 401 });
  }

  const mcpServer = createInternalMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);
  return transport.handleRequest(request);
}

function createInternalMcpServer() {
  const mcpServer = new Server(
    {
      name: "cucumber-internal-tools",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "generate_image",
        description: generateImageToolDescription,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            aspectRatio: { type: "string", minLength: 1 },
            height: { type: "integer", minimum: 1 },
            prompt: { type: "string", minLength: 1 },
            resultCount: { type: "integer", minimum: 1 },
            width: { type: "integer", minimum: 1 },
          },
        },
      },
    ],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name !== "generate_image") {
      throw new Error(`Unknown internal MCP tool: ${request.params.name}`);
    }

    const contextId = readRunContextId(request.params._meta ?? extra._meta);
    if (!contextId) {
      throw new Error("Cucumber MCP run context is missing.");
    }

    const context = getMcpRunContext(contextId);
    if (!context) {
      throw new Error("Cucumber MCP run context has expired.");
    }

    const result = await executeGenerateImageTool({
      args: request.params.arguments ?? {},
      context,
      signal: extra.signal,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
    };
  });

  return mcpServer;
}

function readRunContextId(meta: unknown) {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const contextId = (meta as Record<string, unknown>)[cucumberRunContextMetaKey];
  return typeof contextId === "string" && contextId ? contextId : null;
}
