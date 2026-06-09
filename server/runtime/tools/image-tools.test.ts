import { describe, expect, it } from "vitest";

import { parseExpandedPrompts } from "./image-tools";

describe("image runtime tools", () => {
  it("parses distinct prompt batches from PROMPT lines", () => {
    expect(
      parseExpandedPrompts(
        [
          "PROMPT 1: 一只柯基幼犬在阳光厨房里，暖色自然光，低机位摄影",
          "PROMPT 2: 一只哈士奇幼犬在雪地里奔跑，冷色电影光，动态构图",
          "PROMPT 3: 一只贵宾幼犬在时尚摄影棚里，柔和棚拍光，极简背景",
          "PROMPT 4: 一只腊肠幼犬在花园小径上，好奇回头，浅景深",
        ].join("\n"),
        {
          promptBatchMode: "distinct_prompts",
          requestedResultCount: 4,
        }
      )
    ).toHaveLength(4);
  });

  it("rejects distinct prompt batches with the wrong count", () => {
    expect(() =>
      parseExpandedPrompts("PROMPT 1: 一只小狗\nPROMPT 2: 另一只小狗", {
        promptBatchMode: "distinct_prompts",
        requestedResultCount: 4,
      })
    ).toThrow("exactly 4 distinct prompts");
  });
});
