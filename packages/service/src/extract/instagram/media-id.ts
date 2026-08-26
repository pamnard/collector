/** Instagram shortcode ↔ media id (base64url alphabet used by IG). */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function shortcodeToMediaId(shortcode: string): string {
  let mediaId = 0n;
  for (const char of shortcode) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Malformed Instagram shortcode: ${shortcode}`);
    }
    mediaId = mediaId * 64n + BigInt(index);
  }
  return mediaId.toString();
}
