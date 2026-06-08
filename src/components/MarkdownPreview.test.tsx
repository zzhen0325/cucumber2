// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders markdown content inside the preview surface", () => {
    render(<MarkdownPreview content={"# 方案\n\n上传预览"} />);

    expect(screen.getByText("方案")).toBeTruthy();
    expect(screen.getByText("上传预览")).toBeTruthy();
  });
});
