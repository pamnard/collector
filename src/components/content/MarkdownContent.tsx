import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import type { PluggableList } from "unified";
import { ExternalAnchor } from "./ExternalAnchor";
import { MarkdownPre } from "./MarkdownCodeBlock";

interface MarkdownContentProps {
  content: string;
}

const REMARK_PLUGINS: PluggableList = [remarkGfm];
const REHYPE_PLUGINS: PluggableList = [
  rehypeSlug,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];
const MARKDOWN_COMPONENTS = {
  a: (props: ComponentProps<typeof ExternalAnchor>) => (
    <ExternalAnchor
      {...props}
      className={["border-b border-indigo-400/50 no-underline", props.className]
        .filter(Boolean)
        .join(" ")}
    />
  ),
  pre: MarkdownPre,
};

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="prose dark:prose-invert max-w-none prose-a:text-indigo-400 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-neutral-100 dark:prose-code:bg-neutral-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:font-normal prose-code:text-sm prose-code:text-neutral-900 dark:text-neutral-100 prose-headings:scroll-mt-4">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
