import type { Dispatch, SetStateAction } from "react";
import type { ItemFile } from "@collector/shared";
import type { ItemDetailMode } from "../../components/layout/item-chrome";

/** Drop form/source session so a new item identity never inherits edit mode. */
export function resetItemDetailEditSession(options: {
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
}): void {
  options.setMode("view");
  options.setSourceText(null);
  options.setSourceBaseline(null);
}

/**
 * On item id change: clear item stub + edit session.
 * Same id (e.g. vaultRevision refresh): no-op for edit session.
 */
export function applyItemDetailIdentityChange(options: {
  previousId: string | undefined;
  nextId: string;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
}): boolean {
  if (options.previousId === options.nextId) {
    return false;
  }
  options.setItem(null);
  resetItemDetailEditSession({
    setMode: options.setMode,
    setSourceText: options.setSourceText,
    setSourceBaseline: options.setSourceBaseline,
  });
  return true;
}
