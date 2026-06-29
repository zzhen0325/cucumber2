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

// Parameter resolution with zero fallback. The Image Agent decides prompt,
// resultCount, dimensions, aspectRatio, and variants from the Task Frame
// constraints and passes them as tool args. This layer only cleans and validates
// those args; it does not parse final parameters out of raw text.
export function normalizeImageGenerationParameters({
  candidate,
  maxOutputImages = readMaxOutputImages(),
}: {
  candidate?: ImageGenerationParameterCandidate | null;
  maxOutputImages?: number;
}): ImageGenerationParameters {
  const candidatePrompt = normalizeNullableText(candidate?.prompt);
  const variants = normalizeImageVariants(candidate?.variants);
  const resultCount =
    variants.length > 0
      ? variants.length
      : normalizePositiveInteger(candidate?.resultCount) ?? 1;
  if (resultCount > maxOutputImages) {
    throw new Error(`一次最多生成 ${maxOutputImages} 张图片。`);
  }

  const explicitDimensions =
    normalizeDimensions(candidate?.width, candidate?.height) ??
    (variants.length === 1
      ? { width: variants[0].width, height: variants[0].height }
      : undefined);
  const aspectRatio =
    normalizeAspectRatio(candidate?.aspectRatio) ??
    (explicitDimensions && variants.length <= 1
      ? simplifyAspectRatio(explicitDimensions.width, explicitDimensions.height)
      : undefined);

  const prompt = normalizeContentPrompt(candidatePrompt ?? "");
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

function normalizeContentPrompt(prompt: string) {
  return normalizeText(prompt)
    .replace(/^\s*(?:生成|创建|帮我|请|做|画|出|给我)\s*/i, "")
    .replace(/^\s*(?:的|of)\s*/i, "")
    .replace(/\s+(?:的|of)$/i, "")
    .replace(/^[\s,，:：;；.。-]+/, "")
    .replace(/[\s,，:：;；.。-]+$/, "")
    .replace(/,/g, "，")
    .replace(/图(\d+)\s+/g, "图$1")
    .replace(/，+/g, "，")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageVariants(
  candidateVariants: ImageGenerationVariant[] | null | undefined
) {
  if (!candidateVariants?.length) {
    return [];
  }
  const seen = new Set<string>();
  return candidateVariants.flatMap((variant) => {
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

function normalizeAspectRatio(value: string | null | undefined) {
  const match = normalizeNullableText(value)?.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!match) {
    return undefined;
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

function readMaxOutputImages() {
  const value = Number(process.env.SEEDREAM_MAX_OUTPUT_IMAGES ?? 4);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 4;
}
