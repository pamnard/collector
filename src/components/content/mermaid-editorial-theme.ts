import type { CSSProperties } from "react";
import type { Theme } from "../../hooks/useTheme.ts";

/** Arrow labels — same minimum readable size as nodes (12px). */
export const MERMAID_EDGE_LABEL_FONT_SIZE = "12px";

export const MERMAID_EDGE_LABEL_OUTER_PADDING = {
  x: 8,
  y: 4,
} as const;

export const MERMAID_EDGE_LABEL_NODE_GAP = 8;

export const MERMAID_EDITORIAL_LIGHT = {
  paper: "#f5f5f5",
  toolbar: "#ececee",
  ink: "#2d3142",
  muted: "#4f5d75",
  nodeFill: "#ffffff",
  nodeBorder: "#2d3142",
  clusterFill: "#f0f1f3",
  clusterBorder: "#d8dbe3",
  accent: "#eb6c36",
  accentFill: "#fdf0ea",
  edgeLabelBg: "#f5f5f5",
  edgeLabelInk: "#2d3142",
} as const;

export const MERMAID_EDITORIAL_DARK = {
  paper: "#2a2a2a",
  toolbar: "#363636",
  ink: "#f0f0f0",
  muted: "#a8a8a8",
  nodeFill: "#333333",
  nodeBorder: "#e8e8e8",
  clusterFill: "#323232",
  clusterBorder: "#484848",
  accent: "#f08a59",
  accentFill: "#4a3d36",
  edgeLabelBg: "#2a2a2a",
  edgeLabelInk: "#f0f0f0",
} as const;

export function editorialPalette(theme: Theme) {
  return theme === "dark" ? MERMAID_EDITORIAL_DARK : MERMAID_EDITORIAL_LIGHT;
}

export function mermaidChromeStyle(theme: Theme): CSSProperties {
  const palette = editorialPalette(theme);
  return {
    "--mermaid-chrome-bg": palette.paper,
    "--mermaid-chrome-toolbar-bg": palette.toolbar,
    "--mermaid-chrome-fg": palette.ink,
    "--mermaid-chrome-muted": palette.muted,
    "--mermaid-chrome-hover-bg":
      theme === "dark" ? "rgb(240 240 240 / 0.08)" : "rgb(45 49 66 / 0.08)",
  } as CSSProperties;
}

const EDITORIAL_THEME_CSS = `
  .node rect,
  .node polygon,
  .node circle,
  .node ellipse {
    stroke-width: 1px !important;
    filter: none !important;
  }
  .node rect {
    rx: 6px;
    ry: 6px;
  }
  .edgePath .path,
  .flowchart-link {
    stroke-width: 1px !important;
  }
  .cluster rect {
    stroke-width: 0.8px !important;
    rx: 8px;
    ry: 8px;
  }
  .actor {
    stroke-width: 1px !important;
  }
  .messageLine0,
  .messageLine1 {
    stroke-width: 1px !important;
  }
`;

const FLOWCHART = {
  curve: "rounded" as const,
  defaultRenderer: "elk" as const,
  useMaxWidth: false,
  padding: 16,
  htmlLabels: true,
  rankSpacing: 56,
  nodeSpacing: 40,
  diagramPadding: 12,
};

function buildThemeVariables(
  palette: typeof MERMAID_EDITORIAL_LIGHT,
  darkMode: boolean,
) {
  return {
    darkMode,
    background: palette.paper,
    primaryColor: palette.nodeFill,
    primaryTextColor: palette.ink,
    primaryBorderColor: palette.nodeBorder,
    secondaryColor: palette.clusterFill,
    secondaryTextColor: palette.muted,
    secondaryBorderColor: palette.muted,
    tertiaryColor: palette.accentFill,
    tertiaryTextColor: palette.ink,
    tertiaryBorderColor: palette.accent,
    lineColor: palette.muted,
    textColor: palette.ink,
    mainBkg: palette.nodeFill,
    nodeBorder: palette.nodeBorder,
    clusterBkg: palette.clusterFill,
    clusterBorder: palette.clusterBorder,
    titleColor: palette.muted,
    actorBkg: palette.nodeFill,
    actorBorder: palette.nodeBorder,
    actorTextColor: palette.ink,
    actorLineColor: palette.muted,
    signalColor: palette.muted,
    labelBoxBkgColor: palette.edgeLabelBg,
    labelBoxBorderColor: palette.clusterBorder,
    labelTextColor: palette.edgeLabelInk,
    noteBkgColor: palette.accentFill,
    noteTextColor: palette.ink,
    noteBorderColor: palette.accent,
    fontFamily: '"Golos Text", system-ui, sans-serif',
    fontSize: "12px",
  };
}

const LIGHT_THEME_VARIABLES = buildThemeVariables(MERMAID_EDITORIAL_LIGHT, false);
const DARK_THEME_VARIABLES = buildThemeVariables(MERMAID_EDITORIAL_DARK, true);

export function buildMermaidEditorialInitializeConfig(theme: Theme) {
  return {
    startOnLoad: false as const,
    securityLevel: "strict" as const,
    arrowMarkerAbsolute: true,
    useMaxWidth: false,
    theme: "base" as const,
    themeVariables:
      theme === "dark" ? DARK_THEME_VARIABLES : LIGHT_THEME_VARIABLES,
    flowchart: FLOWCHART,
    themeCSS: EDITORIAL_THEME_CSS,
  };
}
