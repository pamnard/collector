import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Browser/dev URLs stay as-is; absolute disk paths go through Tauri convertFileSrc.
 *
 * Do NOT treat every path starting with `/` as a web URL — on Linux absolute
 * filesystem paths look like `/home/...` and must be converted for the WebView.
 */
export function toDisplayAssetSrc(pathOrUrl: string): string {
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("asset:") ||
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("/__dev/")
  ) {
    return pathOrUrl;
  }
  return convertFileSrc(pathOrUrl);
}
