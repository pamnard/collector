/**
 * Shared companion shortcode stripping for extract plugins.
 * When the note has exactly one other pending candidate that is the resolved
 * id or a companion short-link (`tco:`, `pinit:`), strip both keys from body.
 */

export function companionBodyUrlKeys(
  pending: { shortcode: string }[],
  shortcode: string,
  resolvedKey: string,
  companionPrefix: string,
): string[] {
  const keys = new Set<string>([shortcode, resolvedKey]);
  const others = pending.filter((entry) => entry.shortcode !== shortcode);
  const [other] = others;
  if (others.length === 1 && other) {
    if (other.shortcode === resolvedKey || other.shortcode.startsWith(companionPrefix)) {
      keys.add(other.shortcode);
    }
  }
  return [...keys];
}
