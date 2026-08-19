import type { Theme } from "../../hooks/useTheme.ts";
import { errorMessage } from "../../services/runtime-error.ts";
import {
  buildMermaidEditorialInitializeConfig,
  editorialPalette,
  MERMAID_EDGE_LABEL_FONT_SIZE,
  MERMAID_EDGE_LABEL_NODE_GAP,
  MERMAID_EDGE_LABEL_OUTER_PADDING,
} from "./mermaid-editorial-theme.ts";

type MermaidDefault = typeof import("mermaid").default;

let mermaidLoad: Promise<MermaidDefault> | undefined;
let initializedTheme: Theme | undefined;

async function loadMermaid(): Promise<MermaidDefault> {
  const [mermaidMod, elkLayouts] = await Promise.all([
    import("mermaid"),
    import("@mermaid-js/layout-elk"),
  ]);
  const mermaid = mermaidMod.default;
  mermaid.registerLayoutLoaders(elkLayouts.default);
  return mermaid;
}

export async function getMermaid(theme: Theme): Promise<MermaidDefault> {
  if (!mermaidLoad) {
    mermaidLoad = loadMermaid();
  }
  const mermaid = await mermaidLoad;
  if (initializedTheme !== theme) {
    mermaid.initialize(buildMermaidEditorialInitializeConfig(theme));
    initializedTheme = theme;
  }
  return mermaid;
}

function buildEdgeLabelDisplayStyle(theme: Theme): string {
  const palette = editorialPalette(theme);
  const padX = MERMAID_EDGE_LABEL_OUTER_PADDING.x;
  const padY = MERMAID_EDGE_LABEL_OUTER_PADDING.y;
  return `
    .edgeLabel foreignObject {
      overflow: visible !important;
    }
    .edgeLabel,
    .edgeLabel span,
    .edgeLabel div,
    .edgeLabel p {
      font-size: ${MERMAID_EDGE_LABEL_FONT_SIZE} !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace !important;
      letter-spacing: 0.04em !important;
      line-height: 1.25 !important;
      color: ${palette.edgeLabelInk} !important;
      overflow: visible !important;
    }
    .edgeLabel div {
      max-width: none !important;
      width: auto !important;
      white-space: nowrap !important;
      padding: ${padY}px ${padX}px !important;
      box-sizing: content-box !important;
    }
    .edgeLabel .labelBkg,
    .edgeLabel.labelBkg {
      background-color: ${palette.edgeLabelBg} !important;
    }
  `;
}

export function fixMermaidEdgeLabelsInDom(root: ParentNode): void {
  const padX = MERMAID_EDGE_LABEL_OUTER_PADDING.x;
  const padY = MERMAID_EDGE_LABEL_OUTER_PADDING.y;
  const labels = [...root.querySelectorAll("g.edgeLabel")].filter(
    (group): group is SVGGElement => group instanceof SVGGElement,
  );
  const nodes = [...root.querySelectorAll("g.node")].filter(
    (group): group is SVGGElement => group instanceof SVGGElement,
  );

  for (const fo of root.querySelectorAll("g.edgeLabel foreignObject")) {
    const div = fo.querySelector("div");
    if (!(div instanceof HTMLElement)) {
      continue;
    }
    div.style.maxWidth = "none";
    div.style.width = "auto";
    div.style.overflow = "visible";
    div.style.padding = `${padY}px ${padX}px`;
    div.style.boxSizing = "content-box";
    fo.setAttribute("overflow", "visible");

    const textWidth = div.scrollWidth;
    const textHeight = div.scrollHeight;
    if (textWidth <= 0 || textHeight <= 0) {
      continue;
    }

    fo.setAttribute("width", String(Math.ceil(textWidth)));
    fo.setAttribute("height", String(Math.ceil(textHeight)));
  }

  if (labels.length === 0 || nodes.length === 0) {
    return;
  }

  const svg = labels[0].ownerSVGElement;
  if (!svg) {
    return;
  }

  const ctm = svg.getScreenCTM();
  const scaleX = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
  const scaleY = ctm ? Math.hypot(ctm.c, ctm.d) : 1;
  const minGap = MERMAID_EDGE_LABEL_NODE_GAP;

  for (const label of labels) {
    for (let pass = 0; pass < labels.length; pass += 1) {
      const labelRect = label.getBoundingClientRect();
      let nudged = false;

      for (const node of nodes) {
        const nudge = edgeLabelNodeRepulsion(labelRect, node.getBoundingClientRect(), minGap);
        if (nudge.dx === 0 && nudge.dy === 0) {
          continue;
        }
        nudgeEdgeLabelGroup(label, nudge.dx / scaleX, nudge.dy / scaleY);
        nudged = true;
        break;
      }

      if (!nudged) {
        break;
      }
    }
  }
}

export type EdgeLabelBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function edgeLabelNodeRepulsion(
  label: EdgeLabelBox,
  node: EdgeLabelBox,
  minGap: number,
): { dx: number; dy: number } {
  const overlapX =
    Math.min(label.right, node.right) - Math.max(label.left, node.left);
  const overlapY =
    Math.min(label.bottom, node.bottom) - Math.max(label.top, node.top);

  let dx = 0;
  let dy = 0;

  if (overlapX > 0) {
    if (label.top >= node.bottom - 1) {
      const gap = label.top - node.bottom;
      if (gap < minGap) {
        dy = minGap - gap;
      }
    } else if (label.bottom <= node.top + 1) {
      const gap = node.top - label.bottom;
      if (gap < minGap) {
        dy = -(minGap - gap);
      }
    } else if (overlapY > 0) {
      const labelMid = (label.top + label.bottom) / 2;
      const nodeMid = (node.top + node.bottom) / 2;
      dy = labelMid >= nodeMid ? minGap + overlapY : -(minGap + overlapY);
    }
  }

  if (overlapY > 0) {
    if (label.left >= node.right - 1) {
      const gap = label.left - node.right;
      if (gap < minGap) {
        dx = minGap - gap;
      }
    } else if (label.right <= node.left + 1) {
      const gap = node.left - label.right;
      if (gap < minGap) {
        dx = -(minGap - gap);
      }
    } else if (overlapX > 0) {
      const labelMid = (label.left + label.right) / 2;
      const nodeMid = (node.left + node.right) / 2;
      dx = labelMid >= nodeMid ? minGap + overlapX : -(minGap + overlapX);
    }
  }

  return { dx, dy };
}

function nudgeEdgeLabelGroup(group: SVGGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) {
    return;
  }
  const existing = group.getAttribute("transform")?.trim();
  const nudge = `translate(${dx}, ${dy})`;
  group.setAttribute("transform", existing ? `${existing} ${nudge}` : nudge);
}

export function normalizeMermaidSvgForDisplay(svg: string, theme: Theme): string {
  const openTagMatch = svg.match(/^(\s*)<svg\b([^>]*)>/i);
  if (!openTagMatch) {
    return svg;
  }
  const [, leadingWhitespace, rawAttrs] = openTagMatch;
  const viewBoxMatch = rawAttrs.match(/\bviewBox="([^"]+)"/i);
  if (!viewBoxMatch) {
    return svg;
  }
  const viewBoxParts = viewBoxMatch[1].trim().split(/\s+/);
  if (viewBoxParts.length !== 4) {
    return svg;
  }
  const width = Number(viewBoxParts[2]);
  const height = Number(viewBoxParts[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return svg;
  }

  let attrs = rawAttrs
    .replace(/\s+width="[^"]*"/gi, "")
    .replace(/\s+height="[^"]*"/gi, "")
    .replace(/\s+style="[^"]*"/gi, "");

  const pixelWidth = Math.ceil(width);
  const pixelHeight = Math.ceil(height);
  attrs += ` width="${pixelWidth}" height="${pixelHeight}"`;
  attrs += ` style="width:${pixelWidth}px;height:${pixelHeight}px;max-width:none"`;

  const edgeLabelStyle = `<style type="text/css"><![CDATA[${buildEdgeLabelDisplayStyle(theme)}]]></style>`;

  return svg.replace(
    /^(\s*)<svg\b[^>]*>/i,
    `${leadingWhitespace}<svg${attrs}>${edgeLabelStyle}`,
  );
}

export function mermaidDisplayError(error: unknown): string {
  const message = errorMessage(error).trim();
  return message || "Unknown Mermaid error";
}

export function mermaidRenderDomId(reactId: string): string {
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `mermaid-${safe || "diagram"}`;
}
