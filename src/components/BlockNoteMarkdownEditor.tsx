import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote, useEditorChange } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/theme-context";
import type { MarkdownNodeData } from "@/types/canvas";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

type BlockNoteMarkdownEditorProps = {
  data: MarkdownNodeData;
  nodeId: string;
  readOnly: boolean;
  onChange: (nodeId: string, content: string, blocks: unknown[]) => void;
};

export function BlockNoteMarkdownEditor({
  data,
  nodeId,
  readOnly,
  onChange,
}: BlockNoteMarkdownEditorProps) {
  const { theme } = useTheme();
  const editorTheme = theme === "light" ? "light" : "dark";
  const [initialBlocks] = useState(() => getStoredBlockNoteBlocks(data));
  const hasHydratedMarkdown = useRef(false);
  const hydrating = useRef(false);
  const editor = useCreateBlockNote(
    {
      initialContent: initialBlocks,
    },
    [data.artifact.id]
  );

  useEffect(() => {
    if (initialBlocks || hasHydratedMarkdown.current) {
      return;
    }

    hasHydratedMarkdown.current = true;
    if (!data.content.trim()) {
      return;
    }

    hydrating.current = true;
    try {
      const blocks = editor.tryParseMarkdownToBlocks(data.content);
      if (blocks.length) {
        editor.replaceBlocks(editor.document, blocks);
      }
    } finally {
      window.setTimeout(() => {
        hydrating.current = false;
      }, 0);
    }
  }, [data.content, editor, initialBlocks]);

  useEditorChange((currentEditor) => {
    if (readOnly || hydrating.current) {
      return;
    }

    onChange(
      nodeId,
      currentEditor.blocksToMarkdownLossy(currentEditor.document),
      currentEditor.document
    );
  }, editor);

  return (
    <BlockNoteView
      className="blocknote-editor"
      editable={!readOnly}
      editor={editor}
      theme={editorTheme}
    />
  );
}

function getStoredBlockNoteBlocks(data: MarkdownNodeData) {
  const blocks =
    data.blockNoteBlocks ?? data.artifact.metadata?.blockNoteBlocks;

  if (!Array.isArray(blocks) || !blocks.every(isRecord)) {
    return undefined;
  }

  return blocks as PartialBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
