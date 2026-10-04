/**
 * Serialize {@link ItemPrintModel} into a light-theme print HTML document (#304).
 */

import type {
  ItemPrintInlineMedia,
  ItemPrintModel,
} from "./item-print-model.js";
import { markdownSegmentToHtml } from "./markdown-to-print-html.js";

export type ResolvedPrintMedia =
  | { kind: "image"; dataUri: string; alt: string }
  | { kind: "videoStill"; dataUri: string; filename: string; alt: string }
  | {
      kind: "placeholder";
      mediaType: string;
      filename: string;
      alt: string;
    };

export type ResolvedItemPrintDocument = {
  title: string;
  heroDataUri: string | null;
  bodyParts: Array<
    { kind: "markdown"; text: string } | { kind: "media"; media: ResolvedPrintMedia }
  >;
  fontCss: string;
  katexCss: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mediaToHtml(media: ResolvedPrintMedia): string {
  if (media.kind === "image") {
    return `<figure class="print-inline-media"><img src="${media.dataUri}" alt="${escapeHtml(media.alt)}" /></figure>`;
  }
  if (media.kind === "videoStill") {
    return `<figure class="print-inline-media print-video-still"><img src="${media.dataUri}" alt="${escapeHtml(media.alt || media.filename)}" /><figcaption>Видео: ${escapeHtml(media.filename)}</figcaption></figure>`;
  }
  const label = `${media.mediaType}: ${media.filename}`;
  return `<p class="print-media-placeholder">${escapeHtml(label)}</p>`;
}

export function renderResolvedPrintHtml(doc: ResolvedItemPrintDocument): string {
  const bodyHtml = doc.bodyParts
    .map((part) => {
      if (part.kind === "markdown") {
        return markdownSegmentToHtml(part.text);
      }
      return mediaToHtml(part.media);
    })
    .join("\n");

  const heroHtml = doc.heroDataUri
    ? `<header class="print-hero"><img src="${doc.heroDataUri}" alt="" /></header>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.title)}</title>
<style>
${doc.fontCss}
${doc.katexCss}
:root { color-scheme: light; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #171717;
  font-family: "Golos Text", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.55;
}
.print-root {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 28px 48px;
}
.print-hero img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 8px;
  margin-bottom: 24px;
}
.print-title {
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.25;
  margin: 0 0 1.25rem;
  color: #0a0a0a;
}
.print-body p { margin: 0 0 1em; }
.print-body h1, .print-body h2, .print-body h3 {
  line-height: 1.3;
  margin: 1.4em 0 0.6em;
}
.print-body table {
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
}
.print-body th, .print-body td {
  border: 1px solid #d4d4d4;
  padding: 0.4em 0.65em;
  text-align: left;
  overflow-wrap: anywhere;
}
.print-body th { background: #f5f5f5; font-weight: 600; }
/*
 * Web: overflow-x scroll for wide blocks. PDF: wrap instead of shrink/clip.
 * KaTeX defaults to nowrap — override so long formulas break across lines.
 */
.print-body .katex-display {
  margin: 1em 0;
  max-width: 100%;
  overflow: visible;
  text-align: center;
}
.print-body .katex-display > .katex {
  max-width: 100%;
  display: inline-block;
  text-align: initial;
}
.print-body .katex-display .katex-html,
.print-body .katex-display .katex-html .base {
  max-width: 100%;
}
.print-body .katex-display .katex-html * {
  white-space: normal !important;
}
.print-body .katex {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.print-body p,
.print-body li {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.print-inline-media {
  margin: 1.25em 0;
}
.print-inline-media img {
  display: block;
  max-width: 100%;
  height: auto;
}
.print-inline-media figcaption {
  margin-top: 0.4em;
  font-size: 0.875rem;
  color: #525252;
}
.print-media-placeholder {
  margin: 1em 0;
  padding: 0.75em 1em;
  border: 1px solid #d4d4d4;
  background: #f5f5f5;
  color: #262626;
  font-family: ui-monospace, monospace;
  font-size: 0.9rem;
  white-space: normal;
  overflow-wrap: anywhere;
}
.print-body code {
  font-family: ui-monospace, monospace;
  background: #f5f5f5;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  overflow-wrap: anywhere;
}
.print-body pre {
  background: #f5f5f5;
  padding: 0.9em 1em;
  max-width: 100%;
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: 6px;
}
.print-body pre.mermaid {
  background: transparent;
  padding: 0;
  white-space: normal;
}
/* Vector diagrams cannot line-wrap; keep full glyph size (may span page width). */
.print-body .mermaid svg {
  max-width: none;
  height: auto;
  overflow: visible;
}
.print-body a { color: #4338ca; }
</style>
</head>
<body data-print-theme="light">
<main class="print-root">
${heroHtml}
<h1 class="print-title">${escapeHtml(doc.title)}</h1>
<article class="print-body">
${bodyHtml}
</article>
</main>
</body>
</html>`;
}

export function unresolvedMediaToResolved(
  media: ItemPrintInlineMedia,
  resolve: {
    imageDataUri: (src: string) => string | null;
    videoStillDataUri: (src: string) => string | null;
  },
): ResolvedPrintMedia {
  if (media.kind === "image") {
    const dataUri = resolve.imageDataUri(media.src);
    if (!dataUri) {
      throw new Error(`print image not ready: ${media.src}`);
    }
    return { kind: "image", dataUri, alt: media.alt };
  }
  if (media.kind === "videoStill") {
    const dataUri = resolve.videoStillDataUri(media.src);
    if (!dataUri) {
      throw new Error(`print video still not ready: ${media.src}`);
    }
    return {
      kind: "videoStill",
      dataUri,
      filename: media.filename,
      alt: media.alt,
    };
  }
  return {
    kind: "placeholder",
    mediaType: media.mediaType,
    filename: media.filename,
    alt: media.alt,
  };
}

export function resolvePrintDocument(
  model: ItemPrintModel,
  options: {
    fontCss: string;
    katexCss: string;
    heroDataUri: string | null;
    imageDataUri: (src: string) => string | null;
    videoStillDataUri: (src: string) => string | null;
  },
): ResolvedItemPrintDocument {
  if (model.hero && !options.heroDataUri) {
    throw new Error("print hero not ready");
  }
  const bodyParts: ResolvedItemPrintDocument["bodyParts"] = [];
  for (const part of model.bodyParts) {
    if (part.kind === "markdown") {
      bodyParts.push(part);
      continue;
    }
    bodyParts.push({
      kind: "media",
      media: unresolvedMediaToResolved(part.media, options),
    });
  }
  return {
    title: model.title,
    heroDataUri: options.heroDataUri,
    bodyParts,
    fontCss: options.fontCss,
    katexCss: options.katexCss,
  };
}
