import { describe, expect, it } from "vitest";

import { isLemoImagePrompt } from "./reference-image-prompt.ts";

describe("reference image prompt helpers", () => {
  it("detects Lemo as an explicit subject without matching lemon", () => {
    expect(isLemoImagePrompt("生成 lemo 海报")).toBe(true);
    expect(isLemoImagePrompt("Lemo角色做主视觉")).toBe(true);
    expect(isLemoImagePrompt("make a lemon poster")).toBe(false);
  });
});
