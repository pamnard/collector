/**
 * Cache identity for sidebar search hits.
 *
 * Item `id` is a vault-relative path. Move/rename changes that path, so hits
 * must be refetched whenever the vault revision bumps — not only when the
 * query text changes.
 */
export function sidebarSearchCacheKey(
  query: string,
  vaultRevision: number,
): string {
  return `${vaultRevision}\0${query}`;
}
