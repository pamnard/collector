import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ItemDetailMode } from "../../components/layout/item-chrome";

/** After a successful save: return to view; replace route when id changed. */
export function finishItemDetailSave(options: {
  previousId: string;
  savedId: string;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  navigate: NavigateFunction;
}): void {
  options.setMode("view");
  if (options.savedId !== options.previousId) {
    options.navigate(`/item/${options.savedId}`, { replace: true });
  }
}

/** Drop source editor buffers (clean leave or after source save). */
export function clearItemDetailSourceBuffers(options: {
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
}): void {
  options.setSourceText(null);
  options.setSourceBaseline(null);
}
