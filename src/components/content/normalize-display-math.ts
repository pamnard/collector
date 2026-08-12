/**
 * Obsidian-compatible display math: a whole line `$$...$$` is block math.
 * micromark/remark-math treat same-line `$$...$$` as *inline* (tight `\frac`).
 * Rewrite those lines to the multiline fence form so rehype-katex gets displayMode.
 */
export function normalizeStandaloneDoubleDollarMath(markdown: string): string {
  return markdown.replace(
    /^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm,
    (_, body: string) => `$$\n${body.trim()}\n$$`,
  );
}
