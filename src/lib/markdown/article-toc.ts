import GithubSlugger from "github-slugger";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";

export const ARTICLE_TOC_MIN_ITEMS = 3;

export type ArticleTocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

/**
 * Build a ToC from markdown body headings.
 * Slugger walks every h1–h6 (same as rehype-slug); only h2/h3 become entries.
 */
export function extractArticleToc(markdown: string): ArticleTocItem[] {
  if (!markdown.trim()) {
    return [];
  }

  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const slugger = new GithubSlugger();
  const items: ArticleTocItem[] = [];

  visit(tree, "heading", (node) => {
    const text = toString(node).trim();
    const id = slugger.slug(text);
    if (text === "") {
      return;
    }
    if (node.depth === 2 || node.depth === 3) {
      items.push({ id, text, level: node.depth });
    }
  });

  return items;
}

/** Extract ToC when in view mode and the outline is worth showing; otherwise []. */
export function articleTocForView(
  mode: string,
  content: string | null,
): ArticleTocItem[] {
  if (mode !== "view" || content == null) {
    return [];
  }
  const items = extractArticleToc(content);
  return items.length >= ARTICLE_TOC_MIN_ITEMS ? items : [];
}
