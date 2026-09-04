/**
 * Download remote media bytes for extract attach (#318).
 * Thin wrapper over {@link fetchRemoteBytes} with extract log/error label and
 * optional Referer headers for CDN.
 */

import {
  fetchRemoteBytes,
  REMOTE_DISPLAY_ASSET_MAX_BYTES,
  type FetchRemoteBytesOptions,
} from "./fetch-remote-bytes.js";

/** Same headroom as display-asset localization (videos). */
export const EXTRACT_MEDIA_MAX_BYTES = REMOTE_DISPLAY_ASSET_MAX_BYTES;

export async function fetchExtractMediaBytes(
  url: string,
  options?: Omit<FetchRemoteBytesOptions, "label">,
): Promise<Uint8Array> {
  return fetchRemoteBytes(url, {
    ...options,
    label: "fetchExtractMediaBytes",
  });
}
