export const COMPOSER_MODE_STORAGE_KEY = "cucumber:composer-mode";
export const IMAGE_ASPECT_RATIO_STORAGE_KEY = "cucumber:image-aspect-ratio";
export const IMAGE_RESULT_COUNT_STORAGE_KEY = "cucumber:image-result-count";
export const IMAGE_PROVIDER_STORAGE_KEY = "cucumber:image-provider";

export type ComposerMode = "agent" | "image";
export type ImageAspectRatioSelection = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type ImageResultCountSelection = 1 | 2 | 3 | 4;
export type ImageProviderSelection = "byteartist" | "seed5_duotu_zz";

export function readStoredComposerMode(): ComposerMode {
  if (typeof window === "undefined") {
    return "agent";
  }
  return readComposerMode(window.localStorage.getItem(COMPOSER_MODE_STORAGE_KEY));
}

function readComposerMode(value: string | null | undefined): ComposerMode {
  return value === "image" ? "image" : "agent";
}

export function readStoredImageAspectRatio(): ImageAspectRatioSelection {
  if (typeof window === "undefined") {
    return "1:1";
  }
  return readImageAspectRatioSelection(
    window.localStorage.getItem(IMAGE_ASPECT_RATIO_STORAGE_KEY)
  );
}

export function readImageAspectRatioSelection(
  value: string | null | undefined
): ImageAspectRatioSelection {
  if (
    value === "16:9" ||
    value === "9:16" ||
    value === "4:3" ||
    value === "3:4"
  ) {
    return value;
  }
  return "1:1";
}

export function readStoredImageResultCount(): ImageResultCountSelection {
  if (typeof window === "undefined") {
    return 1;
  }
  return readImageResultCountSelection(
    window.localStorage.getItem(IMAGE_RESULT_COUNT_STORAGE_KEY)
  );
}

export function readImageResultCountSelection(
  value: string | null | undefined
): ImageResultCountSelection {
  if (value === "2") {
    return 2;
  }
  if (value === "3") {
    return 3;
  }
  if (value === "4") {
    return 4;
  }
  return 1;
}

export function readStoredImageProvider(): ImageProviderSelection {
  if (typeof window === "undefined") {
    return "seed5_duotu_zz";
  }
  return readImageProviderSelection(
    window.localStorage.getItem(IMAGE_PROVIDER_STORAGE_KEY)
  );
}

export function readImageProviderSelection(
  value: string | null | undefined
): ImageProviderSelection {
  if (value === "byteartist" || value === "seed5_duotu_zz") {
    return value;
  }
  return "seed5_duotu_zz";
}
