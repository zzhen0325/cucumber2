import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BYTEARTIST_LEMO_MODEL,
  BYTEARTIST_MATTING_MODEL,
  buildByteArtistReqJson,
  doesByteArtistModelSupportReferenceImages,
  extractDefaultByteArtistImages,
  isByteArtistConfigured,
  readByteArtistConfigFromEnv,
  submitAndPollByteArtistImageTask,
} from "./byteartist.ts";

const originalFetch = globalThis.fetch;

describe("ByteArtist provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("uses the seed4 Prompt field for seed4_0407_lemo", () => {
    expect(
      buildByteArtistReqJson({
        height: 1024,
        modelId: "seed4_0407_lemo",
        prompt: "小龙虾形状的 lemo",
        seed: -1,
        width: 1024,
      })
    ).toEqual({
      Prompt: "小龙虾形状的 lemo",
      height: 1024,
      seed: -1,
      width: 1024,
    });
  });

  it("marks seed4_0407_lemo as text-only for reference images", () => {
    expect(doesByteArtistModelSupportReferenceImages(BYTEARTIST_LEMO_MODEL)).toBe(
      false
    );
    expect(doesByteArtistModelSupportReferenceImages("future_model")).toBe(true);
  });

  it("defaults unknown ByteArtist models to the string prompt field", () => {
    expect(
      buildByteArtistReqJson({
        height: 1536,
        modelId: "future_model",
        prompt: "黄瓜海报",
        seed: -1,
        width: 1024,
      })
    ).toEqual({
      height: 1536,
      seed: -1,
      string: "黄瓜海报",
      width: 1024,
    });
  });

  it("extracts ByteArtist URLs and base64 image data", () => {
    expect(
      extractDefaultByteArtistImages({
        pic_urls: [
          { main_url: "https://cdn.example/main.png" },
          { backup_url: "https://cdn.example/backup.png" },
        ],
      })
    ).toEqual([
      "https://cdn.example/main.png",
      "https://cdn.example/backup.png",
    ]);

    expect(
      extractDefaultByteArtistImages({
        binary_data: ["abc123"],
      })
    ).toEqual(["data:image/png;base64,abc123"]);
  });

  it("reads docs-compatible ByteDance env aliases", () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");
    vi.stubEnv("IMAGE_MODEL", "seed4_0407_lemo");

    expect(isByteArtistConfigured()).toBe(true);
    expect(readByteArtistConfigFromEnv()).toMatchObject({
      aid: "6834",
      appKey: "app-key",
      appSecret: "app-secret",
      baseUrl: "https://byteartist.example",
      modelId: "seed4_0407_lemo",
    });
  });

  it("submits raw image tasks with req_json and the official source URL field", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");

    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(init?.body?.toString() ?? "");
        if (String(url).endsWith("/submit_task_v2")) {
          expect(body.get("req_key")).toBe(BYTEARTIST_MATTING_MODEL);
          expect(body.get("source")).toBe("https://assets.example/source.png");
          expect(body.has("image")).toBe(false);
          expect(body.has("image_url")).toBe(false);
          expect(body.has("image_data")).toBe(false);
          expect(body.has("base64file")).toBe(false);
          expect(JSON.parse(body.get("req_json") ?? "{}")).toEqual({
            blue: -1,
            green: -1,
            only_mask: 0,
            red: -1,
            refine_mask: 2,
          });
          return new Response(
            JSON.stringify({ data: { task_id: "task-1" }, status_code: 0 })
          );
        }

        expect(String(url)).toMatch(/\/batch_get_result_v2$/);
        expect(body.get("task_ids")).toBe("task-1");
        return new Response(
          JSON.stringify({
            data: {
              results: {
                "task-1": {
                  pic_urls: [{ main_url: "https://cdn.example/matting.png" }],
                  status: 1,
                },
              },
            },
            status_code: 0,
          })
        );
      }
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      submitAndPollByteArtistImageTask(
        {
          image: "https://assets.example/source.png",
          reqJson: {
            blue: -1,
            green: -1,
            only_mask: 0,
            red: -1,
            refine_mask: 2,
          },
        },
        {
          ...readByteArtistConfigFromEnv(),
          modelId: BYTEARTIST_MATTING_MODEL,
        }
      )
    ).resolves.toEqual({
      imageUrls: ["https://cdn.example/matting.png"],
      taskId: "task-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("submits raw image tasks with the official base64file field", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");

    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(init?.body?.toString() ?? "");
        if (String(url).endsWith("/submit_task_v2")) {
          expect(body.get("base64file")).toBe("CQgH");
          expect(body.has("source")).toBe(false);
          expect(body.has("image_url")).toBe(false);
          expect(body.has("image_data")).toBe(false);
          return new Response(
            JSON.stringify({ data: { task_id: "task-1" }, status_code: 0 })
          );
        }

        return new Response(
          JSON.stringify({
            data: {
              results: {
                "task-1": {
                  pic_urls: [{ main_url: "https://cdn.example/matting.png" }],
                  status: 1,
                },
              },
            },
            status_code: 0,
          })
        );
      }
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      submitAndPollByteArtistImageTask(
        {
          image: "data:image/png;base64,CQgH",
          reqJson: {
            blue: -1,
            green: -1,
            only_mask: 0,
            red: -1,
            refine_mask: 2,
          },
        },
        {
          ...readByteArtistConfigFromEnv(),
          modelId: BYTEARTIST_MATTING_MODEL,
        }
      )
    ).resolves.toMatchObject({
      imageUrls: ["https://cdn.example/matting.png"],
      taskId: "task-1",
    });
  });
});
