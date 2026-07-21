import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Shared token colors for dark theme (editor + markdown view). */
export const darkSyntaxColors = {
  heading: "#e5e7eb",
  link: "#818cf8",
  url: "#94a3b8",
  monospace: "#f472b6",
  meta: "#94a3b8",
  keyword: "#c084fc",
  string: "#86efac",
  number: "#fdba74",
  bool: "#fdba74",
  atom: "#fdba74",
  propertyName: "#7dd3fc",
  comment: "#6b7280",
  processingInstruction: "#94a3b8",
  punctuation: "#9ca3af",
  contentSeparator: "#6b7280",
} as const;

/** Shared token colors for light theme (markdown view; editor uses defaultHighlightStyle). */
export const lightSyntaxColors = {
  heading: "#111827",
  link: "#4f46e5",
  url: "#64748b",
  monospace: "#db2777",
  meta: "#64748b",
  keyword: "#7c3aed",
  string: "#15803d",
  number: "#c2410c",
  bool: "#c2410c",
  atom: "#c2410c",
  propertyName: "#0369a1",
  comment: "#6b7280",
  processingInstruction: "#64748b",
  punctuation: "#475569",
  contentSeparator: "#6b7280",
} as const;

export const darkHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: darkSyntaxColors.heading },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: darkSyntaxColors.link },
  { tag: t.url, color: darkSyntaxColors.url },
  { tag: t.monospace, color: darkSyntaxColors.monospace },
  { tag: t.meta, color: darkSyntaxColors.meta },
  { tag: t.keyword, color: darkSyntaxColors.keyword },
  { tag: t.string, color: darkSyntaxColors.string },
  { tag: t.number, color: darkSyntaxColors.number },
  { tag: t.bool, color: darkSyntaxColors.bool },
  { tag: t.atom, color: darkSyntaxColors.atom },
  { tag: t.propertyName, color: darkSyntaxColors.propertyName },
  {
    tag: t.comment,
    color: darkSyntaxColors.comment,
    fontStyle: "italic",
  },
  {
    tag: t.processingInstruction,
    color: darkSyntaxColors.processingInstruction,
  },
  { tag: t.punctuation, color: darkSyntaxColors.punctuation },
  { tag: t.contentSeparator, color: darkSyntaxColors.contentSeparator },
]);
