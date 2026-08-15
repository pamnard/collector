import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ItemFile } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";
import {
  createItemDetailReloadGate,
  runItemDetailVaultReload,
  type ItemDetailReloadGate,
} from "./item-detail-reload-gate";
import { reloadItemDetail } from "./item-detail-load";

export function useItemDetailLoad(options: {
  id: string | undefined;
  vaultRevision: number;
  setError: (message: string | null) => void;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setContent: Dispatch<SetStateAction<string | null>>;
  setItemTagNames: Dispatch<SetStateAction<string[]>>;
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
}): { reloadGateRef: MutableRefObject<ItemDetailReloadGate> } {
  const {
    id,
    vaultRevision,
    setError,
    setItem,
    setContent,
    setItemTagNames,
    setFormValues,
  } = options;

  const loadedIdRef = useRef<string | undefined>(undefined);
  const reloadGateRef = useRef(createItemDetailReloadGate());

  useEffect(() => {
    if (!id) {
      setError("Item id is missing");
      return;
    }

    setError(null);
    if (loadedIdRef.current !== id) {
      loadedIdRef.current = id;
      setItem(null);
    }

    let cancelled = false;
    void runItemDetailVaultReload({
      gate: reloadGateRef.current,
      isCancelled: () => cancelled,
      reload: async () => {
        await reloadItemDetail({
          itemId: id,
          setItem,
          setContent,
          setItemTagNames,
          setFormValues,
        });
      },
      onError: (message) => {
        setError(message);
      },
    });
    return () => {
      cancelled = true;
    };
  }, [
    id,
    vaultRevision,
    setError,
    setItem,
    setContent,
    setItemTagNames,
    setFormValues,
  ]);

  return { reloadGateRef };
}
