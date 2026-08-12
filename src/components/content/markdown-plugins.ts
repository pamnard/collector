import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import type { PluggableList } from "unified";

/** Shared remark plugins for note body rendering (#463). */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkMath,
];

/** Shared rehype plugins for note body rendering (#463). */
export const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  [
    rehypeKatex,
    {
      throwOnError: false,
      strict: "ignore",
      // Clearer fraction rules under Tailwind preflight + denser prose
      minRuleThickness: 0.08,
    },
  ],
  rehypeSlug,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];
