import type { UpstreamContextItem } from "../../../../src/types/canvas.ts";
import {
  doesByteArtistModelSupportReferenceImages,
  type ByteArtistConfig,
  type ByteArtistGenerateInput,
  type ByteArtistImageRequest,
} from "../../../../byteartist.ts";
import type {
  SeedreamConfig,
  SeedreamGenerateInput,
  SeedreamImageRequest,
  SeedreamPromptBatchMode,
} from "../../../../seedream.ts";

export type SeedreamUpstreamContext = {
  nodeId: string;
  type: "prompt" | "image";
  prompt?: string;
  imageUrl?: string;
  summary?: string;
};

export type GenerateImageSeedreamRequestInput = {
  aspectRatio?: string;
  height?: number;
  prompt: string;
  requestedResultCount?: number;
  variants?: SeedreamGeometryInput[];
  width?: number;
  upstreamContext?: UpstreamContextItem[];
  onImage?: SeedreamGenerateInput["onImage"];
  signal?: AbortSignal;
};

export type GenerateImageByteArtistRequestInput = {
  aspectRatio?: string;
  height?: number;
  prompt: string;
  requestedResultCount?: number;
  variants?: SeedreamGeometryInput[];
  width?: number;
  upstreamContext?: UpstreamContextItem[];
  onImage?: ByteArtistGenerateInput["onImage"];
  signal?: AbortSignal;
};

type SeedreamRequestBuildInput = {
  prompts: string[];
  geometry?: SeedreamGeometryInput;
  variants?: SeedreamGeometryInput[];
  upstreamContext?: SeedreamUpstreamContext[];
  resultCount: number;
  promptBatchMode: SeedreamPromptBatchMode;
};

type SeedreamResolvedGeometry = {
  fields: Record<string, number>;
  targetHeight?: number;
  targetWidth?: number;
};

export type SeedreamGeometryInput = {
  aspectRatio?: string;
  height?: number;
  width?: number;
};

export const SEEDREAM_PROMPT_MAX_LENGTH = 800;

export function buildGenerateImageSeedreamInput(
  input: GenerateImageSeedreamRequestInput,
  config: SeedreamConfig
): SeedreamGenerateInput {
  const normalizedPrompt = normalizeImagePrompt(input.prompt);
  const prompt = normalizeSeedreamProviderPrompt(normalizedPrompt);
  if (!prompt) {
    throw new Error("Seedream image prompt is empty.");
  }

  const variants = normalizeSeedreamVariants(
    input.variants,
    config.maxOutputImages
  );
  const resultCount = variants.length
    ? variants.length
    : resolveImageResultCount(
        input.requestedResultCount,
        [normalizedPrompt],
        config.maxOutputImages
      );

  return {
    requests: buildSeedreamRequestBodies(
      {
        prompts: [normalizedPrompt],
        geometry: {
          aspectRatio: input.aspectRatio,
          height: input.height,
          width: input.width,
        },
        variants,
        resultCount,
        promptBatchMode: "single_prompt",
        upstreamContext: toSeedreamUpstreamContext(input.upstreamContext ?? []),
      },
      config
    ),
    totalRequestedImageCount: resultCount,
    promptBatchMode: "single_prompt",
    onImage: input.onImage,
    signal: input.signal,
  };
}

export function buildGenerateImageByteArtistInput(
  input: GenerateImageByteArtistRequestInput,
  config: ByteArtistConfig
): ByteArtistGenerateInput {
  const normalizedPrompt = normalizeImagePrompt(input.prompt);
  const prompt = normalizeSeedreamProviderPrompt(normalizedPrompt);
  if (!prompt) {
    throw new Error("ByteArtist image prompt is empty.");
  }

  const variants = normalizeSeedreamVariants(
    input.variants,
    config.maxOutputImages
  );
  const resultCount = variants.length
    ? variants.length
    : resolveImageResultCount(
        input.requestedResultCount,
        [normalizedPrompt],
        config.maxOutputImages
      );

  return {
    requests: buildByteArtistRequestBodies(
      {
        prompts: [normalizedPrompt],
        geometry: {
          aspectRatio: input.aspectRatio,
          height: input.height,
          width: input.width,
        },
        variants,
        resultCount,
        promptBatchMode: "single_prompt",
        upstreamContext: toSeedreamUpstreamContext(input.upstreamContext ?? []),
      },
      config
    ),
    totalRequestedImageCount: resultCount,
    onImage: input.onImage,
    signal: input.signal,
  };
}

export function buildSeedreamRequestBodies(
  input: SeedreamRequestBuildInput,
  config: SeedreamConfig
): SeedreamImageRequest[] {
  const imageUrls = collectInputImageUrls(
    input.upstreamContext ?? [],
    config.maxInputImages
  );
  if (input.variants?.length) {
    if (input.variants.length > config.maxOutputImages) {
      throw new Error(`一次最多生成 ${config.maxOutputImages} 张图片。`);
    }
    if (input.prompts.length !== 1) {
      throw new Error("Seedream variant batch must include exactly one prompt.");
    }
    const variantPrompt = normalizeSeedreamProviderPrompt(
      normalizeSingleImagePrompt(input.prompts[0])
    );
    if (!variantPrompt) {
      throw new Error("Seedream image prompt is empty.");
    }

    return input.variants.map((variant, index) => {
      const geometry = resolveSeedreamGeometry(variantPrompt, config, variant);
      const body: Record<string, unknown> = {
        prompt: variantPrompt,
        force_single: config.forceSingle,
        ...geometry.fields,
      };

      if (imageUrls.length) {
        body.image_urls = imageUrls;
      }
      if (config.scale !== undefined) {
        body.scale = config.scale;
      }

      return {
        prompt: variantPrompt,
        promptIndex: index + 1,
        resultCount: 1,
        body,
        imageUrls,
        ...getSeedreamTargetGeometry(geometry),
      };
    });
  }

  return resolveSeedreamPromptRequests(input, config.maxOutputImages).map(
    (request) => {
      const geometry = resolveSeedreamGeometry(
        request.prompt,
        config,
        input.geometry
      );
      const prompt = normalizeSeedreamProviderPrompt(request.prompt);
      const body: Record<string, unknown> = {
        prompt,
        force_single:
          request.resultCount === 1 ? config.forceSingle : false,
        ...geometry.fields,
      };

      if (imageUrls.length) {
        body.image_urls = imageUrls;
      }
      if (config.scale !== undefined) {
        body.scale = config.scale;
      }

      return {
        ...request,
        prompt,
        body,
        imageUrls,
        ...getSeedreamTargetGeometry(geometry),
      };
    }
  );
}

export function buildByteArtistRequestBodies(
  input: SeedreamRequestBuildInput,
  config: ByteArtistConfig
): ByteArtistImageRequest[] {
  const imageUrls = doesByteArtistModelSupportReferenceImages(config.modelId)
    ? collectInputImageUrls(input.upstreamContext ?? [], config.maxInputImages)
    : [];

  if (input.variants?.length) {
    if (input.variants.length > config.maxOutputImages) {
      throw new Error(`一次最多生成 ${config.maxOutputImages} 张图片。`);
    }
    if (input.prompts.length !== 1) {
      throw new Error("ByteArtist variant batch must include exactly one prompt.");
    }
    const variantPrompt = normalizeSeedreamProviderPrompt(
      normalizeSingleImagePrompt(input.prompts[0])
    );
    if (!variantPrompt) {
      throw new Error("ByteArtist image prompt is empty.");
    }

    return input.variants.map((variant, index) => {
      const geometry = resolveByteArtistGeometry(
        variantPrompt,
        config,
        variant
      );
      return {
        prompt: variantPrompt,
        promptIndex: index + 1,
        image: imageUrls[0],
        images: imageUrls,
        inputImageCount: imageUrls.length,
        ...geometry,
      };
    });
  }

  return resolveSeedreamPromptRequests(input, config.maxOutputImages).map(
    (request) => {
      const prompt = normalizeSeedreamProviderPrompt(request.prompt);
      const geometry = resolveByteArtistGeometry(
        prompt,
        config,
        input.geometry
      );
      return {
        prompt,
        promptIndex: request.promptIndex,
        image: imageUrls[0],
        images: imageUrls,
        inputImageCount: imageUrls.length,
        ...geometry,
      };
    }
  );
}

export function resolveImageResultCount(
  requested: number | undefined,
  prompts: readonly string[],
  maxOutputImages: number
): number {
  if (requested !== undefined) {
    if (requested > maxOutputImages) {
      throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
    }
    return Math.max(1, Math.floor(requested));
  }
  return inferImageResultCountFromPrompts(prompts, maxOutputImages);
}

export function inferImageResultCount(prompt: string, maxOutputImages = 4) {
  return inferImageResultCountFromPrompts([prompt], maxOutputImages);
}

export function inferImageResultCountFromPrompts(
  prompts: readonly string[],
  maxOutputImages = 4
) {
  for (const prompt of prompts) {
    const normalized = normalizeImagePrompt(prompt);
    const explicitCount = findExplicitImageCount(normalized);

    if (!explicitCount) {
      continue;
    }
    if (explicitCount > maxOutputImages) {
      throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
    }

    return explicitCount;
  }
  return 1;
}

export function toSeedreamUpstreamContext(
  items: UpstreamContextItem[]
): SeedreamUpstreamContext[] {
  return items.flatMap((item): SeedreamUpstreamContext[] => {
    if (item.type === "prompt") {
      return [
        {
          nodeId: item.nodeId,
          type: "prompt" as const,
          prompt: item.prompt,
          summary: item.summary,
        },
      ];
    }

    const imageUrl =
      item.imageUrl ??
      (item.artifact?.type === "image" ? item.artifact.uri : undefined);
    if (!imageUrl) {
      return [];
    }

    return [
      {
        nodeId: item.nodeId,
        type: "image" as const,
        prompt: item.prompt,
        imageUrl,
        summary: item.summary,
      },
    ];
  });
}

function resolveSeedreamPromptRequests(
  input: SeedreamRequestBuildInput,
  maxOutputImages: number
) {
  if (!Number.isInteger(input.resultCount) || input.resultCount < 1) {
    throw new Error("Seedream resultCount must be a positive integer.");
  }
  if (input.resultCount > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const prompts = input.prompts
    .map((prompt) =>
      input.promptBatchMode === "single_prompt" && input.resultCount > 1
        ? normalizeSingleImagePrompt(prompt)
        : normalizeImagePrompt(prompt)
    )
    .filter(Boolean);
  if (!prompts.length) {
    throw new Error("Seedream image prompt is empty.");
  }

  if (input.promptBatchMode === "distinct_prompts") {
    if (prompts.length !== input.resultCount) {
      throw new Error(
        "Seedream distinct prompt batch must include one prompt per requested image."
      );
    }

    return prompts.map((prompt, index) => ({
      prompt,
      promptIndex: index + 1,
      resultCount: 1,
    }));
  }

  if (prompts.length !== 1) {
    throw new Error("Seedream single prompt batch must include exactly one prompt.");
  }

  return Array.from({ length: input.resultCount }, (_, index) => ({
    prompt: prompts[0],
    promptIndex: index + 1,
    resultCount: 1,
  }));
}

function resolveSeedreamGeometry(
  prompt: string,
  config: Pick<SeedreamConfig, "height" | "width">,
  geometry?: SeedreamGeometryInput
): SeedreamResolvedGeometry {
  if (geometry?.width !== undefined || geometry?.height !== undefined) {
    if (geometry.width === undefined || geometry.height === undefined) {
      throw new Error("Seedream explicit dimensions require both width and height.");
    }
    return normalizeExplicitSeedreamDimensions(geometry.width, geometry.height);
  }

  const requestedAspectRatio = parseAspectRatio(geometry?.aspectRatio);
  if (requestedAspectRatio) {
    const area = findExplicitOutputArea(prompt) ?? config.width * config.height;
    return dimensionsFromAspectRatio(requestedAspectRatio, area);
  }

  const explicitDimensions = findExplicitDimensions(prompt);
  if (explicitDimensions) {
    return explicitDimensions;
  }

  const area = findExplicitOutputArea(prompt) ?? config.width * config.height;
  const aspectRatio = findExplicitAspectRatio(prompt);
  if (aspectRatio) {
    return dimensionsFromAspectRatio(aspectRatio, area);
  }

  if (findExplicitOutputArea(prompt)) {
    return { fields: { size: area } };
  }

  return normalizeExplicitSeedreamDimensions(config.width, config.height);
}

function resolveByteArtistGeometry(
  prompt: string,
  config: Pick<ByteArtistConfig, "height" | "width">,
  geometry?: SeedreamGeometryInput
) {
  const resolved = resolveSeedreamGeometry(prompt, config, geometry);
  const width = readPositiveInteger(resolved.fields.width);
  const height = readPositiveInteger(resolved.fields.height);
  const size = readPositiveInteger(resolved.fields.size);
  const dimensions =
    width !== undefined && height !== undefined
      ? { width, height }
      : size !== undefined
        ? (() => {
            const side = Math.max(1, Math.round(Math.sqrt(size)));
            return { width: side, height: side };
          })()
        : { width: config.width, height: config.height };

  return {
    ...dimensions,
    ...getSeedreamTargetGeometry(resolved),
  };
}

function findExplicitDimensions(prompt: string) {
  const dimensionMatch = prompt.match(
    /\b(\d{3,5})\s*(?:x|×|\*)\s*(\d{3,5})\b/i
  );
  if (!dimensionMatch) {
    return null;
  }

  const width = Number(dimensionMatch[1]);
  const height = Number(dimensionMatch[2]);
  return normalizeExplicitSeedreamDimensions(width, height);
}

function findExplicitOutputArea(prompt: string) {
  if (/\b4\s*k\b|4k|4K|４K|４k/.test(prompt)) {
    return 4096 * 4096;
  }
  if (/\b2\s*k\b|2k|2K|２K|２k/.test(prompt)) {
    return 2048 * 2048;
  }
  if (/\b1\s*k\b|1k|1K|１K|１k/.test(prompt)) {
    return 1024 * 1024;
  }

  return null;
}

function findExplicitAspectRatio(prompt: string) {
  const ratioMatch = prompt.match(/\b(\d{1,2})\s*[:：]\s*(\d{1,2})\b/);
  if (ratioMatch) {
    return parseAspectRatio(`${ratioMatch[1]}:${ratioMatch[2]}`);
  }

  if (/(横版|横图|宽屏|landscape|wide)/i.test(prompt)) {
    return 16 / 9;
  }
  if (/(竖版|竖图|纵向|portrait|vertical)/i.test(prompt)) {
    return 9 / 16;
  }
  if (/(方图|方形|正方形|square)/i.test(prompt)) {
    return 1;
  }

  return null;
}

function parseAspectRatio(value: string | undefined) {
  if (!value) {
    return null;
  }
  const ratioMatch = value.match(/^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/);
  if (!ratioMatch) {
    throw new Error("Seedream aspectRatio must use the format width:height.");
  }
  const widthRatio = Number(ratioMatch[1]);
  const heightRatio = Number(ratioMatch[2]);
  if (widthRatio <= 0 || heightRatio <= 0) {
    throw new Error("Seedream aspectRatio must be positive.");
  }
  const aspectRatio = widthRatio / heightRatio;
  if (aspectRatio < 1 / 16 || aspectRatio > 16) {
    throw new Error("Seedream aspectRatio must be within the supported range.");
  }
  return aspectRatio;
}

function normalizeSeedreamVariants(
  variants: SeedreamGeometryInput[] | undefined,
  maxOutputImages: number
) {
  if (!variants?.length) {
    return [];
  }
  if (variants.length > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const seen = new Set<string>();
  return variants.flatMap((variant) => {
    const width = variant.width === undefined ? undefined : Math.floor(variant.width);
    const height = variant.height === undefined ? undefined : Math.floor(variant.height);
    const aspectRatio = variant.aspectRatio?.trim();
    const key =
      width && height
        ? `${width}x${height}`
        : aspectRatio
          ? `ratio:${aspectRatio}`
          : "";
    if (!key || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      aspectRatio,
      height,
      width,
    }];
  });
}

function dimensionsFromAspectRatio(aspectRatio: number, targetArea: number) {
  const boundedArea = Math.min(
    Math.max(Math.round(targetArea), 1024 * 1024),
    4096 * 4096
  );
  const height = Math.sqrt(boundedArea / aspectRatio);
  let width = Math.max(1, Math.round(height * aspectRatio));
  let roundedHeight = Math.max(1, Math.round(height));

  if (width * roundedHeight < 1024 * 1024) {
    const scale = Math.sqrt((1024 * 1024) / (width * roundedHeight));
    width = Math.ceil(width * scale);
    roundedHeight = Math.ceil(roundedHeight * scale);
  }
  if (width * roundedHeight > 4096 * 4096) {
    const scale = Math.sqrt((4096 * 4096) / (width * roundedHeight));
    width = Math.floor(width * scale);
    roundedHeight = Math.floor(roundedHeight * scale);
  }

  validateSeedreamDimensions(width, roundedHeight);
  return { fields: { width, height: roundedHeight } };
}

function normalizeExplicitSeedreamDimensions(
  width: number,
  height: number
): SeedreamResolvedGeometry {
  const area = width * height;
  const aspectRatio = width / height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    aspectRatio < 1 / 16 ||
    aspectRatio > 16
  ) {
    throw new Error(
      `Seedream width and height must produce a 1K to 4K image within the supported aspect ratio (received ${width}x${height}, area ${area}).`
    );
  }

  if (area >= 1024 * 1024 && area <= 4096 * 4096) {
    return { fields: { width, height } };
  }

  const normalized = dimensionsFromAspectRatio(
    aspectRatio,
    Math.min(Math.max(area, 1024 * 1024), 4096 * 4096)
  );
  return {
    fields: normalized.fields,
    targetHeight: height,
    targetWidth: width,
  };
}

function getSeedreamTargetGeometry(geometry: SeedreamResolvedGeometry) {
  return geometry.targetWidth !== undefined && geometry.targetHeight !== undefined
    ? {
        targetHeight: geometry.targetHeight,
        targetWidth: geometry.targetWidth,
      }
    : {};
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function validateSeedreamDimensions(width: number, height: number) {
  const area = width * height;
  const aspectRatio = width / height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    area < 1024 * 1024 ||
    area > 4096 * 4096 ||
    aspectRatio < 1 / 16 ||
    aspectRatio > 16
  ) {
    throw new Error(
      `Seedream width and height must produce a 1K to 4K image within the supported aspect ratio (received ${width}x${height}, area ${area}).`
    );
  }
}

function findExplicitImageCount(prompt: string) {
  const groupedArabicMatch = prompt.match(
    /(?:一|1)\s*组\s*(\d{1,2})\s*(?:张|幅|个|款|版|images?|imgs?|pictures?|results?)/i
  );
  if (groupedArabicMatch) {
    return Number(groupedArabicMatch[1]);
  }

  const groupedChineseMatch = prompt.match(
    /(?:一|1)\s*组\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|图片|图|结果)/
  );
  if (groupedChineseMatch) {
    return chineseImageCountToNumber(groupedChineseMatch[1]);
  }

  const arabicMatch = prompt.match(
    /(?:生成|出|要|做|给我|create|generate|make)?\s*(\d{1,2})\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)/i
  );
  if (arabicMatch) {
    return Number(arabicMatch[1]);
  }

  const chineseMatch = prompt.match(
    /(?:生成|出|要|做|给我)?\s*([一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|图片|图|结果)/
  );
  if (chineseMatch) {
    return chineseImageCountToNumber(chineseMatch[1]);
  }

  return null;
}

function normalizeSingleImagePrompt(prompt: string) {
  return normalizeImagePrompt(
    stripBatchImageCountInstruction(normalizeImagePrompt(prompt))
  );
}

function stripBatchImageCountInstruction(prompt: string) {
  const stripped = prompt
    .replace(
      /(?:一次\s*)?(?:生成|出|要|做|给我|create|generate|make)?\s*(?:一|1)\s*组\s*(?:\d{1,2}|[一二两三四五六七八九十])\s*(?:张|幅|个|款|版|images?|imgs?|pictures?|results?)(?:\s*(?:图片|图像|图|照片))?\s*(?:of\s+)?/gi,
      ""
    )
    .replace(
      /(?:一次\s*)?(?:生成|出|要|做|给我|create|generate|make)?\s*(?:\d{1,2}|[一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)(?:\s*(?:图片|图像|图|照片))?\s*(?:of\s+)?/gi,
      ""
    )
    .replace(/^(?:的|of)\s*/i, "")
    .replace(/\s+(?:的|of)$/i, "")
    .replace(/^[\s,，:：;；.。-]+/, "")
    .replace(/[\s,，:：;；.。-]+$/, "");

  return normalizeImagePrompt(stripped) || prompt;
}

function chineseImageCountToNumber(value: string) {
  const numbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  return numbers[value] ?? null;
}

function collectInputImageUrls(
  upstreamContext: SeedreamUpstreamContext[],
  limit: number
) {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of upstreamContext) {
    if (item.type !== "image" || !item.imageUrl || seen.has(item.imageUrl)) {
      continue;
    }
    seen.add(item.imageUrl);
    urls.push(item.imageUrl);
    if (urls.length >= limit) {
      break;
    }
  }

  return urls;
}

export function normalizeSeedreamProviderPrompt(prompt: string) {
  const normalized = normalizeImagePrompt(prompt);
  if (normalized.length <= SEEDREAM_PROMPT_MAX_LENGTH) {
    return normalized;
  }

  let output = "";
  for (const char of normalized) {
    if (output.length + char.length > SEEDREAM_PROMPT_MAX_LENGTH) {
      break;
    }
    output += char;
  }

  return output.replace(/[\s,，:：;；.。-]+$/, "").trim();
}

function normalizeImagePrompt(prompt: string) {
  return Array.from(prompt, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
