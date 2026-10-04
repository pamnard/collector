/**
 * Host-side: load vault item → print model → resolved HTML (#304).
 */

import {
  listItemMediaWithPaths,
  resolveItemHeroMedia,
  type VaultContext,
} from "@collector/core";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderResolvedPrintHtml,
  resolvePrintDocument,
} from "./build-item-print-html.js";
import {
  buildItemPrintModel,
  filenameFromMediaSrc,
  safePdfBasename,
} from "./item-print-model.js";

export type BuildItemPrintHtml = (itemId: string) => Promise<{
  html: string;
  filename: string;
  model: ReturnType<typeof buildItemPrintModel>;
}>;

export type VideoStillBytes = (
  absolutePath: string,
  filename: string,
) => Promise<Uint8Array | null>;

function mimeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function readDataUri(absolutePath: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(absolutePath));
  return toDataUri(bytes, mimeForFilename(basename(absolutePath)));
}

function resolveVaultRelativePath(vaultPath: string, src: string): string {
  if (src.startsWith("data:") || isAbsolute(src)) {
    return src;
  }
  if (src.startsWith("file://")) {
    return fileURLToPath(src);
  }
  return join(vaultPath, src.replace(/^\.\//, ""));
}

function golosFontCss(fontFilePath: string | null): string {
  if (!fontFilePath) {
    return '@font-face{font-family:"Golos Text";src:local("Golos Text");font-weight:400 600;}';
  }
  return `@font-face{font-family:"Golos Text";src:url("file://${fontFilePath}") format("woff2");font-weight:400 600;font-display:block;}`;
}

export function createBuildItemPrintHtml(deps: {
  getContext: () => VaultContext;
  resolveActiveVault: () => Promise<{ vault: { id: string }; path: string }>;
  getItem: (itemId: string) => Promise<{
    item: { id: string; title: string };
    content: string | null;
  }>;
  videoStillBytes: VideoStillBytes;
  golosFontPath?: string | null;
}): BuildItemPrintHtml {
  return async (itemId) => {
    const { path: vaultPath } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const { item, content } = await deps.getItem(itemId);
    const body = content ?? "";
    const hero = await resolveItemHeroMedia(ctx.fs, vaultPath, itemId);
    const heroSrc = hero?.displayPath ?? hero?.filePath ?? null;

    const model = buildItemPrintModel({
      title: item.title,
      body,
      heroSrc,
    });

    const mediaRows = await listItemMediaWithPaths(ctx, vaultPath, itemId);
    const byFilename = new Map(
      mediaRows.map((row) => [row.filename, row] as const),
    );

    const imageCache = new Map<string, string>();
    const videoCache = new Map<string, string>();

    const mediaLoads: Array<Promise<void>> = [];
    for (const part of model.bodyParts) {
      if (part.kind !== "media") {
        continue;
      }
      if (part.media.kind === "image") {
        const src = part.media.src;
        mediaLoads.push(
          (async () => {
            if (src.startsWith("data:")) {
              imageCache.set(src, src);
              return;
            }
            const abs = resolveVaultRelativePath(vaultPath, src);
            const exists = await ctx.fs.exists(abs);
            if (exists) {
              imageCache.set(src, await readDataUri(abs));
              return;
            }
            const byName = byFilename.get(filenameFromMediaSrc(src));
            if (!byName) {
              throw new Error(`print image not ready: ${src}`);
            }
            imageCache.set(src, await readDataUri(byName.absolute_path));
          })(),
        );
      } else if (part.media.kind === "videoStill") {
        const src = part.media.src;
        const filename = part.media.filename;
        mediaLoads.push(
          (async () => {
            const abs = resolveVaultRelativePath(vaultPath, src);
            const pathForStill = (await ctx.fs.exists(abs))
              ? abs
              : byFilename.get(filename)?.absolute_path;
            if (!pathForStill) {
              throw new Error(`print video still not ready: ${src}`);
            }
            const still = await deps.videoStillBytes(pathForStill, filename);
            if (!still) {
              throw new Error(`print video still not ready: ${src}`);
            }
            videoCache.set(src, toDataUri(still, "image/webp"));
          })(),
        );
      }
    }
    await Promise.all(mediaLoads);

    let heroDataUri: string | null = null;
    if (heroSrc) {
      if (hero?.kind === "video") {
        if (hero.displayPath && (await ctx.fs.exists(hero.displayPath))) {
          heroDataUri = await readDataUri(hero.displayPath);
        } else {
          const stillPath = hero.displayPath ?? hero.filePath;
          const still = await deps.videoStillBytes(
            stillPath,
            basename(stillPath),
          );
          if (!still) {
            throw new Error("print hero not ready");
          }
          heroDataUri = toDataUri(still, "image/webp");
        }
      } else if (await ctx.fs.exists(heroSrc)) {
        heroDataUri = await readDataUri(heroSrc);
      } else {
        throw new Error("print hero not ready");
      }
    }

    const referenced = new Set(model.referencedFilenames);
    const resolved = resolvePrintDocument(model, {
      fontCss: golosFontCss(deps.golosFontPath ?? null),
      heroDataUri,
      imageDataUri: (src) =>
        src.startsWith("data:") ? src : (imageCache.get(src) ?? null),
      videoStillDataUri: (src) =>
        src.startsWith("data:") ? src : (videoCache.get(src) ?? null),
    });

    const html = renderResolvedPrintHtml(resolved);
    for (const row of mediaRows) {
      if (
        !referenced.has(row.filename) &&
        row.filename !== "cover.webp" &&
        !heroSrc?.endsWith(row.filename) &&
        html.includes(row.filename)
      ) {
        throw new Error(
          `print HTML leaked gallery-only media: ${row.filename}`,
        );
      }
    }

    return {
      html,
      filename: `${safePdfBasename(item.title, itemId)}.pdf`,
      model,
    };
  };
}
