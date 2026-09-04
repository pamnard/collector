import {
  type ImgHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { inferMediaType } from "@collector/shared";
import { cn } from "@/lib/utils";
import { useMediaOverlay } from "../media/MediaOverlayContext";
import { toDisplayAssetSrc } from "../../utils/asset-src";

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown;
};

/** Map markdown image/video src through host media URL when needed (#590). */
export function resolveMarkdownImageSrc(src: string): string {
  return toDisplayAssetSrc(src);
}

/** True when markdown `![](…)` destination is a video file (same embed path as images). */
export function isMarkdownVideoSrc(src: string): boolean {
  let path = src;
  try {
    path = new URL(src, "file:///").pathname;
  } catch {
    // keep raw src
  }
  const q = path.indexOf("?");
  if (q !== -1) {
    path = path.slice(0, q);
  }
  const base = path.split("/").pop() ?? path;
  return inferMediaType(base) === "video";
}

export function MarkdownImage({
  node: _node,
  src,
  className,
  alt,
  onClick,
  onKeyDown,
  title,
  id,
  width,
  height,
  style,
  ...imgProps
}: MarkdownImageProps) {
  const overlay = useMediaOverlay();
  const displaySrc = src ? resolveMarkdownImageSrc(src) : src;
  // Detect from original markdown src — host /media/file URLs hide the extension.
  const isVideo = Boolean(src && isMarkdownVideoSrc(src));

  if (isVideo && displaySrc) {
    return (
      <video
        src={displaySrc}
        controls
        playsInline
        preload="metadata"
        title={title}
        id={id}
        width={width}
        height={height}
        style={style}
        className={cn("block h-auto w-full max-w-full", className)}
      >
        {alt ?? ""}
      </video>
    );
  }

  const canOpen = Boolean(overlay && displaySrc);

  const openPreview = () => {
    if (!overlay || !displaySrc) {
      return;
    }
    overlay.openImage(displaySrc, alt?.trim() || undefined);
  };

  return (
    <img
      {...imgProps}
      src={displaySrc}
      alt={alt ?? ""}
      title={title}
      id={id}
      width={width}
      height={height}
      style={style}
      onClick={(event: MouseEvent<HTMLImageElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        openPreview();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLImageElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !canOpen) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPreview();
        }
      }}
      tabIndex={canOpen ? 0 : undefined}
      role={canOpen ? "button" : undefined}
      aria-label={
        canOpen ? (alt?.trim() ? `Открыть: ${alt}` : "Открыть изображение") : alt
      }
      className={cn(
        "block h-auto w-full max-w-full",
        canOpen && "cursor-zoom-in",
        className,
      )}
    />
  );
}
