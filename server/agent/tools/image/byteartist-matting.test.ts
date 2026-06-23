import { afterEach, describe, expect, it, vi } from "vitest";

import { BYTEARTIST_MATTING_MODEL } from "../../../../byteartist.ts";
import {
  buildByteArtistMattingReqJson,
  readByteArtistMattingConfigFromEnv,
  readByteArtistMattingModelFromEnv,
  runByteArtistMatting,
} from "./byteartist-matting.ts";

const originalFetch = globalThis.fetch;

describe("ByteArtist matting provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("builds image_matting_lemo req_json with screenshot defaults", () => {
    expect(
      buildByteArtistMattingReqJson({
        background: "transparent",
        config: {
          blue: -1,
          green: -1,
          onlyMask: 0,
          red: -1,
          refineMask: 2,
        },
      })
    ).toEqual({
      blue: -1,
      green: -1,
      only_mask: 0,
      red: -1,
      refine_mask: 2,
    });
  });

  it("uses RGB params for explicit non-transparent backgrounds", () => {
    expect(
      buildByteArtistMattingReqJson({
        background: "white",
        config: {
          blue: -1,
          green: -1,
          onlyMask: 0,
          red: -1,
          refineMask: 2,
        },
      })
    ).toMatchObject({
      blue: 255,
      green: 255,
      red: 255,
    });
  });

  it("reads ByteArtist credentials aliases and matting-specific model params", () => {
    vi.stubEnv("GATEWAY_BASE_URL", "https://byteartist.example");
    vi.stubEnv("BYTEDANCE_AID", "6834");
    vi.stubEnv("BYTEDANCE_APP_KEY", "app-key");
    vi.stubEnv("BYTEDANCE_APP_SECRET", "app-secret");
    vi.stubEnv("BYTEARTIST_MATTING_BLUE", "12");
    vi.stubEnv("BYTEARTIST_MATTING_GREEN", "34");
    vi.stubEnv("BYTEARTIST_MATTING_MODEL", "custom_matting_model");
    vi.stubEnv("BYTEARTIST_MATTING_ONLY_MASK", "1");
    vi.stubEnv("BYTEARTIST_MATTING_RED", "56");
    vi.stubEnv("BYTEARTIST_MATTING_REFINE_MASK", "3");

    expect(readByteArtistMattingModelFromEnv()).toBe("custom_matting_model");
    expect(readByteArtistMattingConfigFromEnv()).toMatchObject({
      aid: "6834",
      appKey: "app-key",
      appSecret: "app-secret",
      baseUrl: "https://byteartist.example",
      blue: 12,
      green: 34,
      modelId: "custom_matting_model",
      onlyMask: 1,
      red: 56,
      refineMask: 3,
    });
  });

  it("defaults to image_matting_lemo", () => {
    expect(readByteArtistMattingModelFromEnv()).toBe(BYTEARTIST_MATTING_MODEL);
  });

  it("submits, polls, and downloads a matted image", async () => {
    const config = {
      aid: "6834",
      appKey: "app-key",
      appSecret: "app-secret",
      baseUrl: "https://byteartist.example",
      blue: -1,
      expiredDuration: 600,
      green: -1,
      height: 1024,
      imageReturnFormat: "png",
      imageReturnType: "url",
      maxAttempts: 2,
      maxInputImages: 1,
      maxOutputImages: 1,
      modelId: BYTEARTIST_MATTING_MODEL,
      onlyMask: 0,
      pollIntervalMs: 1,
      red: -1,
      refineMask: 2,
      seed: -1,
      width: 1024,
    };
    const fetchMock = vi.fn(
      async (url: string | URL, init?: RequestInit) => {
        const urlText = String(url);
        if (urlText.endsWith("/submit_task_v2")) {
          const body = new URLSearchParams(init?.body?.toString() ?? "");
          expect(body.get("req_key")).toBe(BYTEARTIST_MATTING_MODEL);
          expect(body.get("source")).toBe("https://assets.example/source.png");
          expect(body.has("image_url")).toBe(false);
          expect(body.has("image_data")).toBe(false);
          expect(body.has("base64file")).toBe(false);
          return new Response(
            JSON.stringify({ data: { task_id: "task-1" }, status_code: 0 })
          );
        }
        if (urlText.endsWith("/batch_get_result_v2")) {
          return new Response(
            JSON.stringify({
              data: {
                results: {
                  "task-1": {
                    pic_urls: [{ main_url: "https://cdn.example/out.png" }],
                    status: 1,
                  },
                },
              },
              status_code: 0,
            })
          );
        }
        expect(urlText).toBe("https://cdn.example/out.png");
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      }
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runByteArtistMatting(
        {
          background: "transparent",
          sourceUrl: "https://assets.example/source.png",
        },
        config
      )
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      engine: BYTEARTIST_MATTING_MODEL,
      metadata: {
        blue: -1,
        green: -1,
        model: BYTEARTIST_MATTING_MODEL,
        only_mask: 0,
        provider: "byteartist",
        red: -1,
        refine_mask: 2,
        sourceTransfer: "url",
        taskId: "task-1",
      },
      mimeType: "image/png",
      provider: "byteartist",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
