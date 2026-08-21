/**
 * Derive the pre-move item id for dashboard prune after itemMoved (#756).
 * Item ids are path-shaped (`folder/name.md`); leaf name is preserved on move.
 */

import type { VaultPresentationChangedPayload } from "@collector/api";

export function itemIdToPruneFromPresentationEvent(
  event: VaultPresentationChangedPayload,
): string | undefined {
  if (event.kind === "itemDeleted") {
    return event.itemId;
  }
  if (
    (event.kind === "itemMoved" ||
      (event.kind === "itemUpserted" &&
        typeof event.fromFolderPath === "string" &&
        typeof event.toFolderPath === "string")) &&
    event.itemId &&
    typeof event.fromFolderPath === "string"
  ) {
    const slash = event.itemId.lastIndexOf("/");
    const leaf = slash === -1 ? event.itemId : event.itemId.slice(slash + 1);
    return event.fromFolderPath ? `${event.fromFolderPath}/${leaf}` : leaf;
  }
  return undefined;
}
