import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AdjacentItemsResult } from "@collector/api";
import type { ItemHeaderActionsModel } from "./ItemHeaderActions";

export type PanelItemHeaderState =
  | { status: "loading" }
  | { status: "ready"; folderPath: string; title: string };

interface PanelHeaderContextValue {
  itemHeader: PanelItemHeaderState | null;
  setItemHeader: (next: PanelItemHeaderState | null) => void;
  itemActions: ItemHeaderActionsModel | null;
  setItemActions: (next: ItemHeaderActionsModel | null) => void;
  itemAdjacent: AdjacentItemsResult | null;
  setItemAdjacent: (next: AdjacentItemsResult | null) => void;
}

const PanelHeaderContext = createContext<PanelHeaderContextValue | null>(null);

export function PanelHeaderProvider({ children }: { children: ReactNode }) {
  const [itemHeader, setItemHeaderState] = useState<PanelItemHeaderState | null>(
    null,
  );
  const [itemActions, setItemActionsState] =
    useState<ItemHeaderActionsModel | null>(null);
  const [itemAdjacent, setItemAdjacentState] =
    useState<AdjacentItemsResult | null>(null);

  const setItemHeader = useCallback((next: PanelItemHeaderState | null) => {
    setItemHeaderState(next);
  }, []);

  const setItemActions = useCallback((next: ItemHeaderActionsModel | null) => {
    setItemActionsState(next);
  }, []);

  const setItemAdjacent = useCallback((next: AdjacentItemsResult | null) => {
    setItemAdjacentState(next);
  }, []);

  const value = useMemo(
    () => ({
      itemHeader,
      setItemHeader,
      itemActions,
      setItemActions,
      itemAdjacent,
      setItemAdjacent,
    }),
    [
      itemHeader,
      setItemHeader,
      itemActions,
      setItemActions,
      itemAdjacent,
      setItemAdjacent,
    ],
  );

  return (
    <PanelHeaderContext.Provider value={value}>
      {children}
    </PanelHeaderContext.Provider>
  );
}

export function usePanelHeader(): PanelHeaderContextValue {
  const context = useContext(PanelHeaderContext);
  if (!context) {
    throw new Error("usePanelHeader must be used within PanelHeaderProvider");
  }
  return context;
}
