import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalAnchor } from "./ExternalAnchor";
import { MarkdownPre } from "./MarkdownCodeBlock";

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="prose dark:prose-invert max-w-none prose-a:text-indigo-400">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{ a: ExternalAnchor, pre: MarkdownPre }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
