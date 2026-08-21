/**
 * Pure relevance helpers for scoped vaultPresentationChanged handling (#756).
 */

import type { VaultPresentationChangedPayload } from "@collector/api";
import { folderParentPath } from "@collector/shared";
import { isFolderFilter, isTagFilter, type NavFilter } from "../types/ui.ts";

const KNOWN_KINDS = new Set<VaultPresentationChangedPayload["kind"]>([
  "itemCreated",
  "itemUpserted",
  "itemDeleted",
  "itemMoved",
  "itemCoverChanged",
  "folderChanged",
]);

export function isVaultPresentationPayload(
  value: unknown,
): value is VaultPresentationChangedPayload {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.vaultId !== "string" || record.vaultId.length === 0) {
    return false;
  }
  if (typeof record.kind !== "string" || !KNOWN_KINDS.has(record.kind as never)) {
    return false;
  }
  return true;
}

export type DashboardLiveAction =
  | "ignore"
  | "softRefresh"
  | "prune"
  | "coverPatch";

function eventHasMoveFields(
  event: VaultPresentationChangedPayload,
): event is VaultPresentationChangedPayload & {
  fromFolderPath: string;
  toFolderPath: string;
} {
  return (
    typeof event.fromFolderPath === "string" &&
    typeof event.toFolderPath === "string"
  );
}

/**
 * Exact folder match (same as queryIndex folder filter), not prefix.
 */
export function dashboardLiveActionForEvent(
  filter: NavFilter,
  event: VaultPresentationChangedPayload,
): DashboardLiveAction {
  if (event.kind === "folderChanged") {
    return "ignore";
  }

  if (event.kind === "itemCoverChanged") {
    if (filter === "all") {
      return "coverPatch";
    }
    if (isFolderFilter(filter)) {
      return event.folderPath === filter.folderPath ? "coverPatch" : "ignore";
    }
    if (isTagFilter(filter)) {
      // v1 payload has no tagIds — soft-refresh any item* on tag views.
      return "softRefresh";
    }
    return "ignore";
  }

  if (event.kind === "itemDeleted") {
    if (filter === "all") {
      return "prune";
    }
    if (isFolderFilter(filter)) {
      return event.folderPath === filter.folderPath ? "prune" : "ignore";
    }
    if (isTagFilter(filter)) {
      return "softRefresh";
    }
    return "ignore";
  }

  if (event.kind === "itemMoved" || eventHasMoveFields(event)) {
    const fromFolderPath = event.fromFolderPath;
    const toFolderPath = event.toFolderPath;
    if (filter === "all") {
      return "softRefresh";
    }
    if (isFolderFilter(filter)) {
      const leaving = fromFolderPath === filter.folderPath;
      const entering = toFolderPath === filter.folderPath;
      if (leaving && !entering) {
        return "prune";
      }
      if (entering) {
        return "softRefresh";
      }
      return "ignore";
    }
    if (isTagFilter(filter)) {
      return "softRefresh";
    }
    return "ignore";
  }

  if (event.kind === "itemCreated" || event.kind === "itemUpserted") {
    if (filter === "all") {
      return "softRefresh";
    }
    if (isFolderFilter(filter)) {
      return event.folderPath === filter.folderPath ? "softRefresh" : "ignore";
    }
    if (isTagFilter(filter)) {
      return "softRefresh";
    }
  }

  return "ignore";
}

/** Sidebar search with a non-empty query soft-refetches on item/move/delete kinds. */
export function sidebarSearchAffectedByEvent(
  searchQuery: string,
  event: VaultPresentationChangedPayload,
): boolean {
  if (!searchQuery.trim()) {
    return false;
  }
  return (
    event.kind === "itemCreated" ||
    event.kind === "itemUpserted" ||
    event.kind === "itemDeleted" ||
    event.kind === "itemMoved"
  );
}

/** Detail / teasers / backlinks / adjacent reload only when itemId matches. */
export function openItemAffectedByEvent(
  openItemId: string | null | undefined,
  event: VaultPresentationChangedPayload,
): boolean {
  if (!openItemId || !event.itemId) {
    return false;
  }
  return event.itemId === openItemId;
}

export type FolderCountPatchPlan =
  | { type: "none" }
  | { type: "reload" }
  | { type: "recount" }
  | { type: "deltas"; deltas: Map<string, number> };

function addAncestorDeltas(
  deltas: Map<string, number>,
  folderPath: string | undefined,
  delta: number,
): void {
  if (folderPath === undefined) {
    return;
  }
  let current = folderPath;
  for (;;) {
    deltas.set(current, (deltas.get(current) ?? 0) + delta);
    if (current === "") {
      break;
    }
    const parent = folderParentPath(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

/**
 * Hierarchical item_count rollup patch plan (#759).
 * itemCreated → ±1 (create); itemUpserted without move → none (edit);
 * move fields / itemMoved / itemDeleted → deltas; folderChanged → reload.
 */
export function folderCountPatchPlanForEvent(
  event: VaultPresentationChangedPayload,
): FolderCountPatchPlan {
  if (event.kind === "folderChanged") {
    return { type: "reload" };
  }
  if (event.kind === "itemCoverChanged") {
    return { type: "none" };
  }
  if (event.kind === "itemDeleted") {
    const deltas = new Map<string, number>();
    addAncestorDeltas(deltas, event.folderPath, -1);
    return deltas.size > 0 ? { type: "deltas", deltas } : { type: "none" };
  }
  if (event.kind === "itemMoved" || eventHasMoveFields(event)) {
    const deltas = new Map<string, number>();
    addAncestorDeltas(deltas, event.fromFolderPath, -1);
    addAncestorDeltas(deltas, event.toFolderPath, 1);
    return deltas.size > 0 ? { type: "deltas", deltas } : { type: "none" };
  }
  if (event.kind === "itemCreated") {
    const deltas = new Map<string, number>();
    addAncestorDeltas(deltas, event.folderPath, 1);
    return deltas.size > 0 ? { type: "deltas", deltas } : { type: "none" };
  }
  // Edit upsert: counts unchanged.
  return { type: "none" };
}

export function mergeFolderCountDeltas(
  into: Map<string, number>,
  from: Map<string, number>,
): void {
  for (const [path, delta] of from) {
    into.set(path, (into.get(path) ?? 0) + delta);
  }
}
