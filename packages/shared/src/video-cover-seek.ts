/**
 * Video cover frame seek — one offset at 5% of duration.
 * Host (ffmpeg) and browser (HTMLVideoElement) share this policy.
 */

/**
 * Seek to 5% of the clip. Missing/invalid duration → 0.
 */
export function seekTargetSeconds(durationSeconds: number | null): number {
  if (
    durationSeconds === null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return 0;
  }
  return durationSeconds * 0.05;
}
