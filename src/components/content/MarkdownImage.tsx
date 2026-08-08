import type { ImgHTMLAttributes } from "react";
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
  ...props
}: MarkdownImageProps) {
  return (
    <img {...props} src={src ? resolveMarkdownImageSrc(src) : src} />
  );
}
