// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { waitForImageDisplayReady } from "./image-preload";

describe("waitForImageDisplayReady", () => {
  it("waits for image load and decode before resolving", async () => {
    const image = createFakeImage();
    const decoded = vi.fn().mockResolvedValue(undefined);
    image.decode = decoded;

    const ready = waitForImageDisplayReady("/api/image/content", {
      createImage: () => image,
      timeoutMs: 0,
    });
    let resolved = false;
    void ready.then(() => {
      resolved = true;
    });

    expect(image.src).toBe("/api/image/content");
    image.onload?.();
    expect(decoded).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    await ready;
    expect(resolved).toBe(true);
  });

  it("rejects when the image cannot load", async () => {
    const image = createFakeImage();
    const ready = waitForImageDisplayReady("/api/missing-image/content", {
      createImage: () => image,
      timeoutMs: 0,
    });

    image.onerror?.();

    await expect(ready).rejects.toThrow("图片预览加载失败");
  });

  it("does not wait for local object urls", async () => {
    const createImage = vi.fn();

    await waitForImageDisplayReady("blob:local-preview", {
      createImage,
      timeoutMs: 0,
    });

    expect(createImage).not.toHaveBeenCalled();
  });
});

type FakeImage = {
  complete: boolean;
  decode?: () => Promise<void>;
  naturalWidth: number;
  onerror: ((event?: unknown) => void) | null;
  onload: (() => void) | null;
  src: string;
};

function createFakeImage(): FakeImage {
  return {
    complete: false,
    naturalWidth: 0,
    onerror: null,
    onload: null,
    src: "",
  };
}
