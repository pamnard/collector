import {
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
} from "./frontmatter.js";
import {
  classifyDropFilename,
  titleStemFromFilename,
} from "./drop-import-classify.js";

/**
 * Title for a dropped file: markdown frontmatter `title` when present, else stem.
 * Uses soft frontmatter partition so foreign/invalid sibling fields do not hide title.
 */
export function resolveDropTitle(
  filename: string,
  rawTextForMd?: string,
): string {
  const classified = classifyDropFilename(filename);
  if (classified.kind === "note" && rawTextForMd !== undefined) {
    const { frontmatter } = parseDocumentMarkdown(rawTextForMd);
    const { known } = partitionDocumentFrontmatter(frontmatter);
    const title = known.title?.trim();
    if (title) {
      return title;
    }
  }
  return titleStemFromFilename(filename);
}
