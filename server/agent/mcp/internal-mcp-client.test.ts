import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  instances: [] as unknown[],
}));

vi.mock("@openai/agents", () => ({
  MCPServerStreamableHttp: class {
    constructor(options: unknown) {
      mocks.instances.push(options);
    }

    connect() {
      return mocks.connect();
    }
  },
}));

const {
  ensureCucumberInternalMcpConnected,
  resetCucumberInternalMcpConnectionForTests,
} = await import("./internal-mcp-client.ts");

describe("internal MCP client pool", () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.instances.length = 0;
    resetCucumberInternalMcpConnectionForTests();
  });

  it("deduplicates concurrent connects through one shared promise", async () => {
    mocks.connect.mockResolvedValue(undefined);

    await Promise.all([
      ensureCucumberInternalMcpConnected(),
      ensureCucumberInternalMcpConnected(),
    ]);

    expect(mocks.instances).toHaveLength(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it("resets the shared promise after a failed connect", async () => {
    mocks.connect
      .mockRejectedValueOnce(new Error("connect failed"))
      .mockResolvedValueOnce(undefined);

    await expect(ensureCucumberInternalMcpConnected()).rejects.toThrow("connect failed");
    await expect(ensureCucumberInternalMcpConnected()).resolves.toBeUndefined();

    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });
});
