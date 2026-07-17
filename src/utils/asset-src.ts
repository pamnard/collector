import { convertFileSrc } from "@tauri-apps/api/core";

/** Browser/dev URLs stay as-is; absolute disk paths go through Tauri convertFileSrc. */
export function toDisplayAssetSrc(pathOrUrl: string): string {
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("/")
  ) {
    return pathOrUrl;
  }
  return convertFileSrc(pathOrUrl);
}
