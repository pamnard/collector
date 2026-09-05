/**
 * Max video height from duration — long clips stay at 480p (no lower).
 */

export type YoutubeMaxHeight = 720 | 480;

/** Inclusive one-hour boundary (seconds). */
export const YOUTUBE_DURATION_720_MAX_SECONDS = 3600;

/**
 * ≤1 hour → 720; longer → 480 (never below).
 */
export function youtubeMaxHeightForDurationSeconds(
  durationSeconds: number,
): YoutubeMaxHeight {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error(
      `YouTube duration refused: expected non-negative finite seconds, got ${durationSeconds}`,
    );
  }
  return durationSeconds <= YOUTUBE_DURATION_720_MAX_SECONDS ? 720 : 480;
}

export function youtubeFormatForMaxHeight(height: YoutubeMaxHeight): string {
  return `bv*[height<=${height}]+ba/b[height<=${height}]`;
}
