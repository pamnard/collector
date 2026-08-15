import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ItemFile } from "@collector/shared";
import type { ItemDetailMode } from "../../components/layout/item-chrome";
import type { ItemFormValues } from "../../types/item";
import {
  createItemDetailReloadGate,
  runItemDetailVaultReload,
  type ItemDetailReloadGate,
} from "./item-detail-reload-gate";
import { reloadItemDetail } from "./item-detail-load";
import { applyItemDetailIdentityChange } from "./reset-item-detail-edit-session";

export function useItemDetailLoad(options: {
  id: string | undefined;
  vaultRevision: number;
  setError: (message: string | null) => void;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setContent: Dispatch<SetStateAction<string | null>>;
  setItemTagNames: Dispatch<SetStateAction<string[]>>;
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
}): { reloadGateRef: MutableRefObject<ItemDetailReloadGate> } {
  const {
    id,
    vaultRevision,
    setError,
    setItem,
    setContent,
    setItemTagNames,
    setFormValues,
    setMode,
    setSourceText,
    setSourceBaseline,
  } = options;

  const loadedIdRef = useRef<string | undefined>(undefined);
  const reloadGateRef = useRef(createItemDetailReloadGate());

  useEffect(() => {
    if (!id) {
      setError("Item id is missing");
      return;
    }

    setError(null);
    if (
      applyItemDetailIdentityChange({
        previousId: loadedIdRef.current,
        nextId: id,
        setItem,
        setMode,
        setSourceText,
        setSourceBaseline,
      })
    ) {
      loadedIdRef.current = id;
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
    setMode,
    setSourceText,
    setSourceBaseline,
  ]);

  return { reloadGateRef };
}
