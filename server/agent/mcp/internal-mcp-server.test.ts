import { describe, expect, it } from "vitest";

import { getInternalMcpAuthorizationHeader } from "./internal-auth.ts";
import { handleInternalMcpRequest } from "./internal-mcp-server.ts";

describe("internal MCP server", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await handleInternalMcpRequest(
      request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, false)
    );

    expect(response.status).toBe(401);
  });

  it("exposes generate_image as a real MCP tool", async () => {
    const initialized = await mcpCall({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      },
    });
    expect(initialized.status).toBe(200);

    const listed = await mcpCall({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      result: {
        tools: [
          expect.objectContaining({
            name: "generate_image",
            inputSchema: expect.objectContaining({
              type: "object",
              properties: expect.objectContaining({
                prompt: expect.objectContaining({ type: "string" }),
                resultCount: expect.objectContaining({ type: "integer" }),
              }),
            }),
          }),
        ],
      },
    });
  });

  it("requires server-side run context metadata for generate_image", async () => {
    const response = await mcpCall({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "generate_image",
        arguments: { prompt: "生成一张图" },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      error: {
        message: expect.stringContaining("Cucumber MCP run context is missing."),
      },
    });
  });
});

async function mcpCall(body: unknown) {
  return handleInternalMcpRequest(request(body, true));
}

function request(body: unknown, authorized: boolean) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (authorized) {
    headers.authorization = getInternalMcpAuthorizationHeader();
  }

  return new Request("http://127.0.0.1/internal/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
