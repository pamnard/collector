import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-input/30 prose-pre:border prose-pre:border-border prose-a:text-indigo-400">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
