import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import type { PluggableList } from "unified";
import { rewriteTextLinksForMarkdown } from "@collector/core";
import { getCollectorService } from "../../services/collector-client";
import { ItemMarkdownAnchor } from "./ItemMarkdownAnchor";
import { collectorMarkdownUrlTransform } from "./item-markdown-href";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownPre } from "./MarkdownCodeBlock";
import { MarkdownTable } from "./MarkdownTable";

interface MarkdownContentProps {
  itemId: string;
  content: string;
}

const REMARK_PLUGINS: PluggableList = [remarkGfm];
const REHYPE_PLUGINS: PluggableList = [
  rehypeSlug,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];
const MARKDOWN_COMPONENTS = {
  a: ItemMarkdownAnchor,
  pre: MarkdownPre,
  img: MarkdownImage,
  table: MarkdownTable,
};

export function MarkdownContent({ itemId, content }: MarkdownContentProps) {
  const [renderContent, setRenderContent] = useState(content);

  useEffect(() => {
    let cancelled = false;
    if (!content.trim()) {
      setRenderContent("");
      return;
    }
    // Keep prior/current body visible until rewrite finishes (no blank flash).
    setRenderContent(content);
    void getCollectorService()
      .items.resolveContentTextLinks(itemId, content)
      .then((links) => {
        if (cancelled) {
          return;
        }
        setRenderContent(rewriteTextLinksForMarkdown(content, links));
      })
      .catch((error: unknown) => {
        console.error("[MarkdownContent] resolveContentTextLinks failed", {
          itemId,
          error,
        });
        if (!cancelled) {
          setRenderContent(content);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, content]);

  if (!content.trim()) {
    return null;
  }

  return (
    <div className="prose dark:prose-invert max-w-none prose-a:text-indigo-400 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-neutral-100 dark:prose-code:bg-neutral-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:font-normal prose-code:text-sm prose-code:text-neutral-900 dark:text-neutral-100 prose-headings:scroll-mt-4">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={collectorMarkdownUrlTransform}
        components={MARKDOWN_COMPONENTS}
      >
        {renderContent}
      </ReactMarkdown>
    </div>
  );
}
