import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";
import {
  ArrowDownloadIcon as Download,
  CodeIcon as Code2,
  EyeIcon as Eye,
} from "@proicons/react";
import { prepareHtmlPreviewDocument } from "@/lib/html-preview";
import type { BundledLanguage } from "shiki";
import { useCallback, useMemo, useState } from "react";

export type HtmlViewMode = "preview" | "source";

type HtmlSourcePreviewProps = {
  className?: string;
  baseUrl?: string;
  defaultMode?: HtmlViewMode;
  filename?: string;
  frameClassName?: string;
  html: string;
  previewDisabled?: boolean;
  previewDisabledText?: string;
  previewLabel?: string;
  showLineNumbers?: boolean;
  sourceClassName?: string;
  sourceLabel?: string;
  title?: string;
};

const htmlLanguage = "html" as BundledLanguage;

export function HtmlSourcePreview({
  baseUrl,
  className,
  defaultMode = "source",
  filename,
  frameClassName,
  html,
  previewDisabled = false,
  previewDisabledText = "暂无预览",
  previewLabel = "预览",
  showLineNumbers = false,
  sourceClassName,
  sourceLabel = "html",
  title = "HTML",
}: HtmlSourcePreviewProps) {
  const [mode, setMode] = useState<HtmlViewMode>(defaultMode);
  const hasHtml = html.trim().length > 0;
  const canPreview = hasHtml && !previewDisabled;
  const visibleMode = mode;
  const downloadName = useMemo(
    () => getHtmlDownloadFilename(filename ?? title),
    [filename, title]
  );
  const previewHtml = useMemo(
    () => prepareHtmlPreviewDocument(html, baseUrl),
    [baseUrl, html]
  );
  const switchMode = useCallback((nextMode: HtmlViewMode) => {
    setMode(nextMode);
  }, []);
  const handleDownload = useCallback(() => {
    downloadTextFile(downloadName, html, "text/html;charset=utf-8");
  }, [downloadName, html]);

  const actions = (
    <>
      <HtmlModeSwitch
        canPreview={canPreview}
        mode={visibleMode}
        onModeChange={switchMode}
        previewLabel={previewLabel}
      />
      <Button
        aria-label="下载 HTML"
        className="html-source-preview-icon-button"
        disabled={!hasHtml}
        onClick={(event) => {
          event.stopPropagation();
          handleDownload();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        size="icon-xs"
        title="下载 HTML"
        type="button"
        variant="ghost"
      >
        <Download size={14} />
      </Button>
    </>
  );

  if (visibleMode === "source") {
    return (
      <CodeBlock
        className={cn(
          "html-source-preview html-source-preview-code",
          className,
          sourceClassName
        )}
        code={html || previewDisabledText}
        language={htmlLanguage}
        showLineNumbers={showLineNumbers}
      >
        <CodeBlockHeader className="html-source-preview-header">
          <CodeBlockTitle>
            <CodeBlockFilename>{sourceLabel}</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            {actions}
            <CodeBlockCopyButton
              aria-label="复制源码"
              className="html-source-preview-icon-button"
              disabled={!hasHtml}
              title="复制源码"
            />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    );
  }

  return (
    <div
      className={cn("html-source-preview html-source-preview-frame-card", className)}
    >
      <div className="html-source-preview-header">
        <span className="html-source-preview-title">{title}</span>
        <div className="html-source-preview-actions">{actions}</div>
      </div>
      <div
        className={cn("html-source-preview-frame", frameClassName)}
      >
        {canPreview ? (
          <iframe
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-scripts"
            srcDoc={previewHtml}
            title={`${title} ${previewLabel}`}
          />
        ) : (
          <div className="html-source-preview-empty">{previewDisabledText}</div>
        )}
      </div>
    </div>
  );
}

function HtmlModeSwitch({
  canPreview,
  mode,
  onModeChange,
  previewLabel,
}: {
  canPreview: boolean;
  mode: HtmlViewMode;
  onModeChange: (mode: HtmlViewMode) => void;
  previewLabel: string;
}) {
  return (
    <div
      aria-label="HTML 显示模式"
      className="html-source-preview-switch"
      role="group"
    >
      <button
        aria-label="预览 HTML"
        aria-pressed={mode === "preview"}
        disabled={!canPreview}
        onClick={(event) => {
          event.stopPropagation();
          onModeChange("preview");
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        title="预览"
        type="button"
      >
        <Eye size={13} />
        <span>{previewLabel}</span>
      </button>
      <button
        aria-label="查看 HTML 源码"
        aria-pressed={mode === "source"}
        onClick={(event) => {
          event.stopPropagation();
          onModeChange("source");
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        title="源码"
        type="button"
      >
        <Code2 size={13} />
        <span>源码</span>
      </button>
    </div>
  );
}

function getHtmlDownloadFilename(value: string) {
  const baseName =
    value
      .trim()
      .replace(/\.html?$/i, "")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "index";
  return `${baseName}.html`;
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
