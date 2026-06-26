import { describe, expect, it } from "vitest";

import { repairMarkdownBlockBoundaries } from "./markdown-artifact";

describe("repairMarkdownBlockBoundaries", () => {
  it("keeps valid markdown unchanged", () => {
    const content = "# 标题\n\n## 小节\n\n正文";

    expect(repairMarkdownBlockBoundaries(content)).toBe(content);
  });

  it("restores collapsed markdown block markers", () => {
    expect(
      repairMarkdownBlockBoundaries("# 标题 ## 小节 ``` prompt ``` --- ## 下一节")
    ).toBe("# 标题\n\n## 小节\n\n```\nprompt\n\n```\n---\n\n## 下一节");
  });

  it("keeps collapsed tables out of headings", () => {
    expect(
      repairMarkdownBlockBoundaries("## 生成参数参考 | 项目 | 推荐配置 | |------|----------|")
    ).toBe("## 生成参数参考\n\n| 项目 | 推荐配置 | |------|----------|");
  });
});
