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
