import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BYTEARTIST_LEMO_MODEL,
  BYTEARTIST_MATTING_MODEL,
  BYTEARTIST_SEED5_DUOTU_MODEL,
  buildByteArtistReqJson,
  doesByteArtistModelSupportReferenceImages,
  extractDefaultByteArtistImages,
  generateByteArtistImage,
  isByteArtistConfigured,
  readByteArtistConfigFromEnv,
  submitAndPollByteArtistImageTask,
  withByteArtistModelConfig,
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

  it("uses the seed5_duotu_zz multi-image request shape", () => {
    expect(
      buildByteArtistReqJson({
        height: 2048,
        modelId: BYTEARTIST_SEED5_DUOTU_MODEL,
        prompt: "将图1、图2融合在一张图内",
        seed: -1,
        width: 2048,
      })
    ).toEqual({
      extra_inputs: {
        height: 2048,
        width: 2048,
      },
      user_prompt: "将图1、图2融合在一张图内",
    });
    expect(
      doesByteArtistModelSupportReferenceImages(BYTEARTIST_SEED5_DUOTU_MODEL)
    ).toBe(true);
    expect(
      withByteArtistModelConfig(
        {
          ...readByteArtistConfigFromEnv({
            BYTEARTIST_AID: "6834",
            BYTEARTIST_APP_KEY: "app-key",
            BYTEARTIST_APP_SECRET: "app-secret",
            BYTEARTIST_BASE_URL: "https://byteartist.example",
          }),
          maxInputImages: 1,
        },
        BYTEARTIST_SEED5_DUOTU_MODEL
      )
    ).toMatchObject({
      height: 2048,
      maxInputImages: 6,
      modelId: BYTEARTIST_SEED5_DUOTU_MODEL,
      width: 2048,
    });
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
      generateStaggerMs: 800,
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

  it("submits seed5 multi-image references as multipart files", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");

    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = String(url);
        if (requestUrl === "https://assets.example/ref-1.png") {
          return new Response("ref-1", {
            headers: { "Content-Type": "image/png" },
          });
        }
        if (requestUrl === "https://assets.example/ref-2.png") {
          return new Response("ref-2", {
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        if (requestUrl.endsWith("/submit_task_v2")) {
          expect(init?.body).toBeInstanceOf(FormData);
          const body = init?.body as FormData;
          expect(body.get("req_key")).toBe(BYTEARTIST_SEED5_DUOTU_MODEL);
          expect(body.get("input_img_type")).toBe("multiple_files");
          expect(JSON.parse(String(body.get("req_json")))).toEqual({
            extra_inputs: {
              height: 2048,
              width: 2048,
            },
            user_prompt: "将图1、图2融合在一张图内",
          });
          expect(body.getAll("files[]")).toHaveLength(2);
          expect(init?.headers).toBeUndefined();
          return new Response(
            JSON.stringify({ data: { task_id: "task-1" }, status_code: 0 })
          );
        }

        expect(requestUrl).toMatch(/\/batch_get_result_v2$/);
        const body = new URLSearchParams(init?.body?.toString() ?? "");
        expect(body.get("task_ids")).toBe("task-1");
        return new Response(
          JSON.stringify({
            data: {
              results: {
                "task-1": {
                  pic_urls: [{ main_url: "https://cdn.example/fused.png" }],
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
          imageField: "files",
          images: [
            "https://assets.example/ref-1.png",
            "https://assets.example/ref-2.png",
          ],
          reqJson: buildByteArtistReqJson({
            height: 2048,
            modelId: BYTEARTIST_SEED5_DUOTU_MODEL,
            prompt: "将图1、图2融合在一张图内",
            seed: -1,
            width: 2048,
          }),
        },
        {
          ...readByteArtistConfigFromEnv(),
          modelId: BYTEARTIST_SEED5_DUOTU_MODEL,
        }
      )
    ).resolves.toEqual({
      imageUrls: ["https://cdn.example/fused.png"],
      taskId: "task-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("starts generated image tasks in parallel with the configured stagger", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");

    const submitStarts: number[] = [];
    let activePolls = 0;
    let maxActivePolls = 0;
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = String(url);
        const body = new URLSearchParams(init?.body?.toString() ?? "");
        if (requestUrl.endsWith("/submit_task_v2")) {
          submitStarts.push(Date.now());
          const reqJson = JSON.parse(String(body.get("req_json")));
          const prompt = String(reqJson.Prompt ?? reqJson.user_prompt);
          return new Response(
            JSON.stringify({
              data: { task_id: `task-${prompt.at(-1)}` },
              status_code: 0,
            })
          );
        }

        const taskId = body.get("task_ids") ?? "task";
        activePolls += 1;
        maxActivePolls = Math.max(maxActivePolls, activePolls);
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        activePolls -= 1;
        return new Response(
          JSON.stringify({
            data: {
              results: {
                [taskId]: {
                  pic_urls: [{ main_url: `https://cdn.example/${taskId}.png` }],
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

    const startedAt = Date.now();
    const result = await generateByteArtistImage(
      {
        requests: [1, 2, 3].map((index) => ({
          height: 1024,
          inputImageCount: 0,
          prompt: `prompt-${index}`,
          promptIndex: index,
          width: 1024,
        })),
        totalRequestedImageCount: 3,
      },
      {
        ...readByteArtistConfigFromEnv(),
        generateStaggerMs: 10,
      }
    );

    expect(submitStarts).toHaveLength(3);
    expect(submitStarts[0] - startedAt).toBeLessThan(100);
    expect(submitStarts[1] - submitStarts[0]).toBeGreaterThanOrEqual(8);
    expect(submitStarts[2] - submitStarts[1]).toBeGreaterThanOrEqual(8);
    expect(maxActivePolls).toBeGreaterThan(1);
    expect(result).toMatchObject({
      images: [
        { metadata: { promptIndex: 1 } },
        { metadata: { promptIndex: 2 } },
        { metadata: { promptIndex: 3 } },
      ],
    });
  });

  it("surfaces provider errors from completed ByteArtist tasks", async () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");

    const fetchMock = vi.fn(
      async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/submit_task_v2")) {
          return new Response(
            JSON.stringify({ data: { task_id: "task-1" }, status_code: 0 })
          );
        }

        return new Response(
          JSON.stringify({
            data: {
              results: [
                {
                  pic_urls: null,
                  status: "done",
                  status_code: 23001,
                  status_message: "Pre Img Risk Not Pass",
                },
              ],
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
          reqJson: {
            extra_inputs: {
              height: 2048,
              width: 2048,
            },
            user_prompt: "将图1、图2融合在一张图内",
          },
        },
        {
          ...readByteArtistConfigFromEnv(),
          modelId: BYTEARTIST_SEED5_DUOTU_MODEL,
        }
      )
    ).rejects.toThrow(
      "ByteArtist task completed with provider error [23001]: Pre Img Risk Not Pass"
    );
  });
});
