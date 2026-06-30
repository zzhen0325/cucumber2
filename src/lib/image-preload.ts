type PreloadImage = {
  complete?: boolean;
  decode?: () => Promise<void>;
  naturalWidth?: number;
  onerror: ((event?: unknown) => void) | null;
  onload: (() => void) | null;
  src: string;
};

type WaitForImageDisplayReadyOptions = {
  createImage?: () => PreloadImage | null;
  timeoutMs?: number;
};

const DEFAULT_IMAGE_PRELOAD_TIMEOUT_MS = 15_000;

export async function waitForImageDisplayReady(
  url: string,
  options: WaitForImageDisplayReadyOptions = {}
) {
  if (!url || isInlineOrLocalImageUrl(url)) {
    return;
  }

  const image = options.createImage?.() ?? createBrowserImage();
  if (!image) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
      image.onload = null;
      image.onerror = null;

      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const decodeAndFinish = () => {
      if (typeof image.decode !== "function") {
        finish();
        return;
      }

      void image.decode().then(
        () => finish(),
        () => finish(new Error("图片预览解码失败。"))
      );
    };

    image.onload = decodeAndFinish;
    image.onerror = () => finish(new Error("图片预览加载失败。"));

    const timeoutMs =
      options.timeoutMs ?? DEFAULT_IMAGE_PRELOAD_TIMEOUT_MS;
    if (timeoutMs > 0) {
      timeoutId = globalThis.setTimeout(
        () => finish(new Error("图片预览加载超时。")),
        timeoutMs
      );
    }

    image.src = url;
    if (image.complete && (image.naturalWidth ?? 0) > 0) {
      decodeAndFinish();
    }
  });
}

function createBrowserImage() {
  if (typeof Image === "undefined") {
    return null;
  }

  return new Image();
}

function isInlineOrLocalImageUrl(url: string) {
  return url.startsWith("blob:") || url.startsWith("data:");
}
