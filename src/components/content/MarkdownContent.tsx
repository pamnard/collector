import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalAnchor } from "./ExternalAnchor";

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="prose dark:prose-invert max-w-none prose-pre:border prose-pre:border-border prose-a:text-indigo-400 [--tw-prose-pre-bg:rgb(var(--bg-input)/0.3)] [--tw-prose-pre-code:rgb(var(--text-main))] dark:[--tw-prose-pre-bg:rgb(var(--bg-input)/0.3)] dark:[--tw-prose-pre-code:rgb(var(--text-main))]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ExternalAnchor }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
