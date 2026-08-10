import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AdjacentItemsResult } from "@collector/api";
import type { ItemHeaderActionsModel } from "../ItemHeaderActions";
import {
  mapDomainToActions,
  mapDomainToBreadcrumbs,
} from "./map-domain-to-actions";
import type {
  ItemChromeBreadcrumbState,
  ItemChromeDomain,
  ItemChromeItemRef,
} from "./types";
import { useItemAdjacent } from "./use-item-adjacent";

interface ItemChromeController {
  publish: (domain: ItemChromeDomain) => void;
  clear: () => void;
}

interface ItemChromeHeaderView {
  breadcrumbs: ItemChromeBreadcrumbState | null;
  actions: ItemHeaderActionsModel | null;
}

interface ItemChromeContextValue {
  domain: ItemChromeDomain | null;
  publish: (domain: ItemChromeDomain) => void;
  clear: () => void;
  adjacent: AdjacentItemsResult | null;
}

const ItemChromeContext = createContext<ItemChromeContextValue | null>(null);

export function ItemChromeProvider({ children }: { children: ReactNode }) {
  const [domain, setDomain] = useState<ItemChromeDomain | null>(null);
  const adjacent = useItemAdjacent(domain);

  const publish = useCallback((next: ItemChromeDomain) => {
    setDomain(next);
  }, []);

  const clear = useCallback(() => {
    setDomain(null);
  }, []);

  const value = useMemo(
    () => ({
      domain,
      publish,
      clear,
      adjacent,
    }),
    [domain, publish, clear, adjacent],
  );

  return (
    <ItemChromeContext.Provider value={value}>
      {children}
    </ItemChromeContext.Provider>
  );
}

function useItemChromeContext(): ItemChromeContextValue {
  const context = useContext(ItemChromeContext);
  if (!context) {
    throw new Error("useItemChrome* must be used within ItemChromeProvider");
  }
  return context;
}

export function useItemChrome(): ItemChromeController {
  const { publish, clear } = useItemChromeContext();
  return useMemo(() => ({ publish, clear }), [publish, clear]);
}

export function useItemChromeHeader(): ItemChromeHeaderView {
  const { domain } = useItemChromeContext();
  return useMemo(
    () => ({
      breadcrumbs: mapDomainToBreadcrumbs(domain),
      actions: mapDomainToActions(domain),
    }),
    [domain],
  );
}

export function useItemChromeAdjacent(): AdjacentItemsResult | null {
  return useItemChromeContext().adjacent;
}

/** Ready item stub for bottom chrome (related fallback, etc.). */
export function useItemChromeItem(): ItemChromeItemRef | null {
  const { domain } = useItemChromeContext();
  if (domain?.status !== "ready" || domain.item === null) {
    return null;
  }
  return domain.item;
}

/** Ready item folder path for sidebar highlight; `null` when chrome has no ready item. */
export function useItemChromeFolderPath(): string | null {
  return useItemChromeItem()?.folder_path ?? null;
}
