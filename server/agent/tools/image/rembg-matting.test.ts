import { EventEmitter } from "node:events";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.fn();
const spawnSync = vi.fn();
const mkdtemp = vi.fn();
const readFile = vi.fn();
const rm = vi.fn();
const writeFile = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  spawnSync: (...args: unknown[]) => spawnSync(...args),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: (...args: unknown[]) => mkdtemp(...args),
  readFile: (...args: unknown[]) => readFile(...args),
  rm: (...args: unknown[]) => rm(...args),
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

const {
  buildRembgCliArgs,
  isRembgCliConfigured,
  readRembgMattingConfigFromEnv,
  runRembgCliMatting,
} = await import("./rembg-matting.ts");

type MockChildProcess = EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter;
  stdout: EventEmitter;
};

const originalFetch = globalThis.fetch;

describe("rembg matting provider", () => {
  beforeEach(() => {
    spawn.mockReset();
    spawnSync.mockReset();
    mkdtemp.mockReset();
    readFile.mockReset();
    rm.mockReset();
    writeFile.mockReset();
    mkdtemp.mockResolvedValue("/tmp/cucumber-rembg-test");
    readFile.mockResolvedValue(Buffer.from([4, 5, 6]));
    rm.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
        status: 200,
      })
    );
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds rembg CLI args from config and background", () => {
    const config = readRembgMattingConfigFromEnv({
      REMBG_ALPHA_BACKGROUND_THRESHOLD: "12",
      REMBG_ALPHA_ERODE_SIZE: "8",
      REMBG_ALPHA_FOREGROUND_THRESHOLD: "230",
      REMBG_BIN: "custom-rembg",
      REMBG_MODEL: "u2net_human_seg",
      REMBG_POST_PROCESS_MASK: "1",
    });

    expect(config.bin).toBe("custom-rembg");
    expect(
      buildRembgCliArgs({
        background: "neutral",
        config,
        inputPath: "/tmp/in.png",
        outputPath: "/tmp/out.png",
      })
    ).toEqual([
      "i",
      "--model",
      "u2net_human_seg",
      "--alpha-matting",
      "--alpha-matting-foreground-threshold",
      "230",
      "--alpha-matting-background-threshold",
      "12",
      "--alpha-matting-erode-size",
      "8",
      "--post-process-mask",
      "--bgcolor",
      "242",
      "242",
      "239",
      "255",
      "/tmp/in.png",
      "/tmp/out.png",
    ]);
  });

  it("checks rembg CLI availability without running a matting job", () => {
    spawnSync.mockReturnValue({ status: 0 });

    expect(
      isRembgCliConfigured({
        ...readRembgMattingConfigFromEnv(),
        bin: "rembg-test",
        healthCheckTimeoutMs: 50,
      })
    ).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith("rembg-test", ["--version"], {
      stdio: "ignore",
      timeout: 50,
    });
  });

  it("runs rembg CLI and cleans up temp files", async () => {
    const child = createMockChildProcess();
    spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    const result = await runRembgCliMatting({
      background: "white",
      sourceUrl: "https://assets.example/ref.png",
    });

    expect(result).toMatchObject({
      engine: "rembg",
      mimeType: "image/png",
      provider: "rembg-cli",
    });
    expect(spawn).toHaveBeenCalledWith(
      "rembg",
      expect.arrayContaining(["--bgcolor", "255", "255", "255", "255"]),
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] })
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/cucumber-rembg-test/source.image",
      new Uint8Array([1, 2, 3])
    );
    expect(readFile).toHaveBeenCalledWith(
      "/tmp/cucumber-rembg-test/foreground.png"
    );
    expect(rm).toHaveBeenCalledWith("/tmp/cucumber-rembg-test", {
      force: true,
      recursive: true,
    });
  });

  it("surfaces rembg CLI failures and still cleans up", async () => {
    const child = createMockChildProcess();
    spawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stderr.emit("data", "model failed");
        child.emit("close", 2);
      });
      return child;
    });

    await expect(
      runRembgCliMatting({ sourceUrl: "https://assets.example/ref.png" })
    ).rejects.toThrow(/model failed/);
    expect(rm).toHaveBeenCalledWith("/tmp/cucumber-rembg-test", {
      force: true,
      recursive: true,
    });
  });

  it("aborts an active rembg process and cleans up", async () => {
    const child = createMockChildProcess();
    const controller = new AbortController();
    controller.abort();
    spawn.mockReturnValue(child);

    await expect(
      runRembgCliMatting({
        signal: controller.signal,
        sourceUrl: "https://assets.example/ref.png",
      })
    ).rejects.toThrow(/aborted/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(rm).toHaveBeenCalledWith("/tmp/cucumber-rembg-test", {
      force: true,
      recursive: true,
    });
  });
});

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.kill = vi.fn();
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  return child;
}
