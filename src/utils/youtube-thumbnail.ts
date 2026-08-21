/**
 * YouTube URL detection for playback chrome. Does not build CDN image URLs (#739).
 */

import { parseYouTubeVideoId } from "@collector/core";

export { parseYouTubeVideoId };

export function isYouTubeWatchUrl(url: string): boolean {
  return parseYouTubeVideoId(url) !== null;
}
