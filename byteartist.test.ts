import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildByteArtistReqJson,
  extractDefaultByteArtistImages,
  isByteArtistConfigured,
  readByteArtistConfigFromEnv,
} from "./byteartist.ts";

describe("ByteArtist provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
});
