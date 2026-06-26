export type ImageGenerationVariant = {
  height: number;
  label?: string;
  width: number;
};

export type ImageGenerationParameterCandidate = {
  aspectRatio?: string | null;
  height?: number | null;
  prompt?: string | null;
  resultCount?: number | null;
  variants?: ImageGenerationVariant[] | null;
  width?: number | null;
};

export type ImageGenerationParameters = {
  aspectRatio?: string;
  height?: number;
  prompt: string;
  resultCount: number;
  variants?: ImageGenerationVariant[];
  width?: number;
};

export function normalizeImageGenerationParameters({
  candidate,
  defaultAspectRatio,
  defaultResultCount,
  maxOutputImages = readMaxOutputImages(),
  rawPrompt,
}: {
  candidate?: ImageGenerationParameterCandidate | null;
  defaultAspectRatio?: string | null;
  defaultResultCount?: number | null;
  maxOutputImages?: number;
  rawPrompt: string;
}): ImageGenerationParameters {
  const raw = normalizeText(rawPrompt);
  const candidatePrompt = normalizeNullableText(candidate?.prompt);
  const variants = normalizeImageVariants(candidate?.variants, raw);
  const resultCount =
    variants.length > 0
      ? variants.length
      : normalizePositiveInteger(candidate?.resultCount) ??
        normalizePositiveInteger(defaultResultCount) ??
        inferImageResultCount(raw) ??
        1;
  if (resultCount > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const explicitDimensions =
    normalizeDimensions(candidate?.width, candidate?.height) ??
    (variants.length === 1
      ? { width: variants[0].width, height: variants[0].height }
      : findExplicitDimensions(raw) ?? undefined);
  const aspectRatio =
    normalizeAspectRatio(candidate?.aspectRatio) ??
    normalizeAspectRatio(defaultAspectRatio) ??
    (explicitDimensions && variants.length <= 1
      ? simplifyAspectRatio(explicitDimensions.width, explicitDimensions.height)
      : undefined) ??
    findExplicitAspectRatio(raw) ??
    undefined;
  let prompt =
    normalizeContentPrompt(candidatePrompt ?? raw) ||
    normalizeContentPrompt(raw) ||
    (isImageCanvasExpansionRequest(raw)
      ? "基于参考图扩展画布，保持原图主体、文字、风格、光影和构图一致，补全新增区域。"
      : "");
  if (isImageCanvasExpansionRequest(raw) && isGenericImageReferencePrompt(prompt)) {
    prompt =
      "基于参考图扩展画布，保持原图主体、文字、风格、光影和构图一致，补全新增区域。";
  }

  if (!prompt) {
    throw new Error("Image Agent did not produce an image content prompt.");
  }

  return {
    prompt,
    resultCount,
    aspectRatio,
    width: explicitDimensions?.width,
    height: explicitDimensions?.height,
    variants: variants.length ? variants : undefined,
  };
}

function normalizeDimensions(
  width: number | null | undefined,
  height: number | null | undefined
) {
  const normalizedWidth = normalizePositiveInteger(width);
  const normalizedHeight = normalizePositiveInteger(height);
  if (!normalizedWidth || !normalizedHeight) {
    return null;
  }
  return {
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function normalizePositiveInteger(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const integer = Math.floor(Number(value));
  return integer > 0 ? integer : null;
}

function inferImageResultCount(prompt: string) {
  const dimensionVariants = findDimensionVariants(prompt);
  if (dimensionVariants.length > 1) {
    return dimensionVariants.length;
  }

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

function normalizeContentPrompt(prompt: string) {
  return normalizeText(prompt)
    .replace(/\b\d{1,2}\s*[:：]\s*\d{1,2}\b/g, " ")
    .replace(/\b\d{3,5}\s*(?:x|×|\*|-|–|—)\s*\d{3,5}\b/gi, " ")
    .replace(/(?:拓展|扩展|扩图|调整|改成|转成)?\s*\d{1,2}\s*个\s*尺寸/gi, " ")
    .replace(/(?:拓展|扩展|扩图|扩画布|延展|外扩|outpaint|resize)(?:这张|这个|当前|选中)?(?:图|图片|画布)?/gi, " ")
    .replace(
      /(?:一次\s*)?(?:生成|出|要|做|给我|create|generate|make)?\s*(?:一|1)\s*组\s*(?:\d{1,2}|[一二两三四五六七八九十])\s*(?:张|幅|个|款|版|images?|imgs?|pictures?|results?)(?!\s*(?:图|图片|图像|照片)?\s*(?:内|里|中))(?:\s*(?:图片|图像|图|照片))?\s*(?:of\s+)?/gi,
      " "
    )
    .replace(
      /(?:一次\s*)?(?:生成|出|要|做|给我|create|generate|make)?\s*(?:\d{1,2}|[一二两三四五六七八九十])\s*(?:张|幅|个|款|版|组|images?|imgs?|pictures?|results?)(?!\s*(?:图|图片|图像|照片)?\s*(?:内|里|中))(?:\s*(?:图片|图像|图|照片))?\s*(?:of\s+)?/gi,
      " "
    )
    .replace(/^\s*(?:生成|创建|帮我|请|做|画|出|给我)\s*/i, "")
    .replace(/^\s*(?:的|of)\s*/i, "")
    .replace(/\s+(?:的|of)$/i, "")
    .replace(/^[\s,，:：;；.。-]+/, "")
    .replace(/[\s,，:：;；.。-]+$/, "")
    .replace(/,/g, "，")
    .replace(/\b((?:banner\s+)?KV|banner)\s+(主体)/i, "$1，$2")
    .replace(/图(\d+)\s+/g, "图$1")
    .replace(/，+/g, "，")
    .replace(/\s+/g, " ")
    .trim();
}

function findExplicitDimensions(prompt: string) {
  const dimensionMatch = findDimensionVariants(prompt)[0];
  if (!dimensionMatch) {
    return null;
  }
  return {
    width: dimensionMatch.width,
    height: dimensionMatch.height,
  };
}

function normalizeImageVariants(
  candidateVariants: ImageGenerationVariant[] | null | undefined,
  prompt: string
) {
  const promptVariants = findDimensionVariants(prompt);
  const candidates =
    candidateVariants && candidateVariants.length
      ? candidateVariants
      : isImageCanvasExpansionRequest(prompt) || promptVariants.length > 1
        ? promptVariants
        : [];
  const seen = new Set<string>();
  return candidates.flatMap((variant) => {
    const width = Math.floor(Number(variant.width));
    const height = Math.floor(Number(variant.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return [];
    }
    const key = `${width}x${height}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      width,
      height,
      label: normalizeNullableText(variant.label) ?? undefined,
    }];
  });
}

function findDimensionVariants(prompt: string) {
  const variants: Array<{ width: number; height: number; label?: string }> = [];
  const seen = new Set<string>();
  const dimensionPattern =
    /(^|[^\d])(\d{3,5})\s*(?:x|×|\*|-|–|—)\s*(\d{3,5})(?=$|[^\d])/gi;
  for (const match of prompt.matchAll(dimensionPattern)) {
    const width = Number(match[2]);
    const height = Number(match[3]);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      continue;
    }
    const key = `${width}x${height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    variants.push({
      width,
      height,
      label: `${width}x${height}`,
    });
  }
  return variants;
}

function findExplicitAspectRatio(prompt: string) {
  const ratioMatch = prompt.match(/\b(\d{1,2})\s*[:：]\s*(\d{1,2})\b/);
  if (ratioMatch) {
    return `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}`;
  }
  if (/(横版|横图|宽屏|landscape|wide)/i.test(prompt)) {
    return "16:9";
  }
  if (/(竖版|竖图|纵向|portrait|vertical)/i.test(prompt)) {
    return "9:16";
  }
  if (/(方图|方形|正方形|square)/i.test(prompt)) {
    return "1:1";
  }
  return null;
}

function normalizeAspectRatio(value: string | null | undefined) {
  const match = normalizeNullableText(value)?.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!match) {
    return null;
  }
  return `${Number(match[1])}:${Number(match[2])}`;
}

function simplifyAspectRatio(width: number, height: number) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}

function isGenericImageReferencePrompt(prompt: string) {
  const normalized = normalizeText(prompt)
    .replace(/[\s,，:：;；.。/\\|_-]+/g, " ")
    .trim();
  return /^(?:把|将|给我|帮我)?\s*(?:这个|这张|当前|选中|参考)?\s*(?:图|图片|图像|画布|image|picture)\s*$/i.test(
    normalized
  );
}

function isImageCanvasExpansionRequest(prompt: string) {
  const hasExpansionCue =
    /(扩图|扩画布|扩边|补边|外扩|外延|延展|拓展|扩展|拓宽|扩充|outpaint|outpainting|extend(?:\s+the)?\s+canvas|canvas\s+extension|expand(?:\s+the)?\s+image)/i.test(
      prompt
    );
  const hasDimensionResizeCue =
    /(拓展|扩展|扩图|调整|改成|转成|resize|尺寸|版位|比例|aspect\s*ratio).{0,24}(尺寸|画布|比例|版位|\d{3,5}\s*(?:x|×|\*|-|–|—)\s*\d{3,5})/i.test(
      prompt
    );
  const hasDimensionList = findDimensionVariants(prompt).length > 0;
  return (
    (hasExpansionCue || hasDimensionResizeCue) &&
    (hasActualImageCue(prompt) || hasDimensionList)
  );
}

function hasActualImageCue(prompt: string) {
  return /(这个图|这个图片|这张图|这张图片|这张照片|这幅图|这幅图片|此图|图里|图中|图片里|图片中|照片里|照片中|选中的图|选中图片|参考图|reference image|selected image|this image|this picture|photo)/i.test(
    prompt
  );
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeText(value) || null;
}

function normalizeText(value: string) {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .replace(/([\u4e00-\u9fff])([A-Za-z][A-Za-z0-9]*)/g, "$1 $2")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
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

function readMaxOutputImages() {
  const value = Number(process.env.SEEDREAM_MAX_OUTPUT_IMAGES ?? 4);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 4;
}
