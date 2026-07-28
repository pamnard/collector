import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_SELECTION,
  isSelected,
  loadedSelectionState,
  selectAllMatching as toAllMatching,
  selectedCount,
  shouldShowSelectAllMatching,
  toggleLoaded,
  toggleRow as toggleRowSelection,
  type DashboardTableSelection,
  type LoadedSelectionState,
} from "./dashboard-table-selection";

export interface UseDashboardTableSelectionArgs {
  queryKey: string;
  loadedIds: readonly string[];
  totalCount: number;
}

export interface UseDashboardTableSelectionResult {
  selection: DashboardTableSelection;
  selectedCount: number;
  loadedState: LoadedSelectionState;
  showSelectAllMatching: boolean;
  isRowSelected: (id: string) => boolean;
  toggleRow: (id: string) => void;
  setLoadedSelected: (select: boolean) => void;
  selectAllMatching: () => void;
  clear: () => void;
}

export function useDashboardTableSelection({
  queryKey,
  loadedIds,
  totalCount,
}: UseDashboardTableSelectionArgs): UseDashboardTableSelectionResult {
  const [selection, setSelection] =
    useState<DashboardTableSelection>(EMPTY_SELECTION);

  useEffect(() => {
    setSelection(EMPTY_SELECTION);
  }, [queryKey]);

  const isRowSelected = useCallback(
    (id: string) => isSelected(selection, id),
    [selection],
  );

  const toggleRow = useCallback((id: string) => {
    setSelection((prev) => toggleRowSelection(prev, id));
  }, []);

  const setLoadedSelected = useCallback(
    (select: boolean) => {
      setSelection((prev) => toggleLoaded(prev, loadedIds, select, totalCount));
    },
    [loadedIds, totalCount],
  );

  const selectAllMatching = useCallback(() => {
    setSelection(toAllMatching());
  }, []);

  const clear = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);

  return {
    selection,
    selectedCount: selectedCount(selection, totalCount),
    loadedState: loadedSelectionState(selection, loadedIds),
    showSelectAllMatching: shouldShowSelectAllMatching(
      selection,
      loadedIds,
      totalCount,
    ),
    isRowSelected,
    toggleRow,
    setLoadedSelected,
    selectAllMatching,
    clear,
  };
}
