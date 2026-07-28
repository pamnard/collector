export type DashboardTableSelection =
  | { mode: "none" }
  | { mode: "explicit"; ids: ReadonlySet<string> }
  | { mode: "allMatching"; exclusions: ReadonlySet<string> };

export type LoadedSelectionState = "none" | "some" | "all";

export const EMPTY_SELECTION: DashboardTableSelection = { mode: "none" };

export function isSelected(
  selection: DashboardTableSelection,
  id: string,
): boolean {
  if (selection.mode === "none") {
    return false;
  }
  if (selection.mode === "explicit") {
    return selection.ids.has(id);
  }
  return !selection.exclusions.has(id);
}

export function selectedCount(
  selection: DashboardTableSelection,
  totalCount: number,
): number {
  if (selection.mode === "none") {
    return 0;
  }
  if (selection.mode === "explicit") {
    return selection.ids.size;
  }
  return Math.max(0, totalCount - selection.exclusions.size);
}

function explicitFromIds(ids: ReadonlySet<string>): DashboardTableSelection {
  if (ids.size === 0) {
    return EMPTY_SELECTION;
  }
  return { mode: "explicit", ids };
}

function allMatchingFromExclusions(
  exclusions: ReadonlySet<string>,
  totalCount: number,
): DashboardTableSelection {
  const count = Math.max(0, totalCount - exclusions.size);
  if (count === 0) {
    return EMPTY_SELECTION;
  }
  return { mode: "allMatching", exclusions };
}

export function toggleRow(
  selection: DashboardTableSelection,
  id: string,
): DashboardTableSelection {
  if (selection.mode === "allMatching") {
    const exclusions = new Set(selection.exclusions);
    if (exclusions.has(id)) {
      exclusions.delete(id);
    } else {
      exclusions.add(id);
    }
    // totalCount unknown here — keep allMatching even if exclusions grow;
    // callers that know totalCount should normalize via toggleLoaded/selectAll.
    return { mode: "allMatching", exclusions };
  }

  const ids = new Set(selection.mode === "explicit" ? selection.ids : []);
  if (ids.has(id)) {
    ids.delete(id);
  } else {
    ids.add(id);
  }
  return explicitFromIds(ids);
}

export function toggleLoaded(
  selection: DashboardTableSelection,
  loadedIds: readonly string[],
  select: boolean,
  totalCount: number,
): DashboardTableSelection {
  if (selection.mode === "allMatching") {
    const exclusions = new Set(selection.exclusions);
    if (select) {
      for (const id of loadedIds) {
        exclusions.delete(id);
      }
    } else {
      for (const id of loadedIds) {
        exclusions.add(id);
      }
    }
    return allMatchingFromExclusions(exclusions, totalCount);
  }

  const ids = new Set(selection.mode === "explicit" ? selection.ids : []);
  if (select) {
    for (const id of loadedIds) {
      ids.add(id);
    }
  } else {
    for (const id of loadedIds) {
      ids.delete(id);
    }
  }
  return explicitFromIds(ids);
}

export function selectAllMatching(): DashboardTableSelection {
  return { mode: "allMatching", exclusions: new Set() };
}

export function loadedSelectionState(
  selection: DashboardTableSelection,
  loadedIds: readonly string[],
): LoadedSelectionState {
  if (loadedIds.length === 0) {
    return "none";
  }
  let selected = 0;
  for (const id of loadedIds) {
    if (isSelected(selection, id)) {
      selected += 1;
    }
  }
  if (selected === 0) {
    return "none";
  }
  if (selected === loadedIds.length) {
    return "all";
  }
  return "some";
}

export function shouldShowSelectAllMatching(
  selection: DashboardTableSelection,
  loadedIds: readonly string[],
  totalCount: number,
): boolean {
  if (selection.mode === "allMatching") {
    return false;
  }
  if (totalCount <= loadedIds.length) {
    return false;
  }
  return loadedSelectionState(selection, loadedIds) === "all";
}

export function selectionQueryKey(ctx: {
  vaultId: string;
  filterKey: string;
  search: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
}): string {
  const base = `${ctx.vaultId}|${ctx.filterKey}|${ctx.search.trim()}`;
  if (ctx.sortKey === undefined && ctx.sortDir === undefined) {
    return base;
  }
  return `${base}|${ctx.sortKey ?? "created_at"}|${ctx.sortDir ?? "desc"}`;
}
