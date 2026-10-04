/**
 * Serialize {@link ItemPrintModel} into a light-theme print HTML document (#304).
 */

import type {
  ItemPrintBodyPart,
  ItemPrintInlineMedia,
  ItemPrintModel,
} from "./item-print-model.js";

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
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal markdown → HTML for print body text segments (GFM-ish subset). */
export function markdownSegmentToHtml(text: string): string {
  if (!text.trim()) {
    return "";
  }
  const escaped = escapeHtml(text);
  const withCode = escaped.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      const cls = lang ? ` language-${lang}` : "";
      if (lang === "mermaid") {
        return `<pre class="mermaid">${code}</pre>`;
      }
      return `<pre><code class="${cls.trim()}">${code}</code></pre>`;
    },
  );
  const withInlineCode = withCode.replace(
    /`([^`]+)`/g,
    "<code>$1</code>",
  );
  const withBold = withInlineCode.replace(
    /\*\*([^*]+)\*\*/g,
    "<strong>$1</strong>",
  );
  const withItalic = withBold.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const withLinks = withItalic.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2">$1</a>',
  );
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return "";
      }
      if (trimmed.startsWith("<pre")) {
        return trimmed;
      }
      if (/^#{1,6}\s/.test(trimmed)) {
        return trimmed.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, title: string) => {
          const level = hashes.length;
          return `<h${level}>${title}</h${level}>`;
        });
      }
      if (/^[-*]\s+/m.test(trimmed)) {
        const items = trimmed
          .split(/\n/)
          .filter((line) => /^[-*]\s+/.test(line))
          .map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${trimmed.replace(/\n/g, "<br />")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
  return paragraphs;
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
}
.print-body code {
  font-family: ui-monospace, monospace;
  background: #f5f5f5;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.print-body pre {
  background: #f5f5f5;
  padding: 0.9em 1em;
  overflow: auto;
  border-radius: 6px;
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
    heroDataUri: string | null;
    imageDataUri: (src: string) => string | null;
    videoStillDataUri: (src: string) => string | null;
  },
): ResolvedItemPrintDocument {
  if (model.hero && !options.heroDataUri) {
    throw new Error("print hero not ready");
  }
  const bodyParts: ResolvedItemPrintDocument["bodyParts"] = [];
  for (const part of model.bodyParts as ItemPrintBodyPart[]) {
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
  };
}

export function buildItemPrintHtmlFromResolved(
  doc: ResolvedItemPrintDocument,
): string {
  return renderResolvedPrintHtml(doc);
}
