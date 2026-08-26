import {
  type ImgHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { cn } from "@/lib/utils";
import { useMediaOverlay } from "../media/MediaOverlayContext";
import { toDisplayAssetSrc } from "../../utils/asset-src";

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown;
};

/** Map markdown image src through host media URL when needed (#590). */
export function resolveMarkdownImageSrc(src: string): string {
  return toDisplayAssetSrc(src);
}

export function MarkdownImage({
  node: _node,
  src,
  className,
  alt,
  onClick,
  onKeyDown,
  ...props
}: MarkdownImageProps) {
  const overlay = useMediaOverlay();
  const displaySrc = src ? resolveMarkdownImageSrc(src) : src;
  const canOpen = Boolean(overlay && displaySrc);

  const openPreview = () => {
    if (!overlay || !displaySrc) {
      return;
    }
    overlay.openImage(displaySrc, alt?.trim() || undefined);
  };

  return (
    <img
      {...props}
      src={displaySrc}
      alt={alt ?? ""}
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
