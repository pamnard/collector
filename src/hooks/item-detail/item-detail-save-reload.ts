import type { Dispatch, SetStateAction } from "react";
import type { ItemFormValues } from "../../types/item";
import type { ItemFile } from "@collector/shared";
import { reloadItemDetail } from "./item-detail-load";
import type { ItemDetailReloadGate } from "./item-detail-reload-gate";

export async function reloadItemDetailAfterSave(options: {
  itemId: string;
  gate: ItemDetailReloadGate;
  reload?: typeof reloadItemDetail;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setContent: Dispatch<SetStateAction<string | null>>;
  setItemTagNames: Dispatch<SetStateAction<string[]>>;
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
}): Promise<void> {
  const {
    itemId,
    gate,
    reload = reloadItemDetail,
    setItem,
    setContent,
    setItemTagNames,
    setFormValues,
  } = options;
  gate.markSaveReloadInFlight(itemId);
  try {
    await reload({
      itemId,
      setItem,
      setContent,
      setItemTagNames,
      setFormValues,
    });
    if (gate.hasPendingDerivedCompleteReload(itemId)) {
      gate.clearPendingDerivedCompleteReload(itemId);
      await reload({
        itemId,
        setItem,
        setContent,
        setItemTagNames,
        setFormValues,
      });
    }
  } finally {
    gate.clearSaveReloadInFlight(itemId);
  }
}
