import { Component, type ErrorInfo, type ReactNode } from "react";

import { MessageResponse } from "@/components/ai-elements/message";

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <MarkdownPreviewBoundary content={content}>
      <MessageResponse>{content}</MessageResponse>
    </MarkdownPreviewBoundary>
  );
}

type MarkdownPreviewBoundaryProps = {
  children: ReactNode;
  content: string;
};

type MarkdownPreviewBoundaryState = {
  failed: boolean;
};

class MarkdownPreviewBoundary extends Component<
  MarkdownPreviewBoundaryProps,
  MarkdownPreviewBoundaryState
> {
  state: MarkdownPreviewBoundaryState = {
    failed: false,
  };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[markdown-preview]", error, info.componentStack);
  }

  componentDidUpdate(previousProps: MarkdownPreviewBoundaryProps) {
    if (
      this.state.failed &&
      previousProps.content !== this.props.content
    ) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <PlainMarkdownPreview content={this.props.content} />;
    }

    return this.props.children;
  }
}

function PlainMarkdownPreview({ content }: MarkdownPreviewProps) {
  return <pre className="markdown-plain-preview">{content}</pre>;
}
