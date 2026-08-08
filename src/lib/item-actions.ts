import type { ItemFile } from "@collector/shared";
import type { AlertsApi } from "../components/alerts/alert-store";
import { runWithBusyAlert } from "../components/alerts/run-with-busy-alert";
import { getCollectorService } from "../services/collector-client";

export const ITEM_RENAME_BUSY_ID = "item-rename-busy";
export const ITEM_RENAME_ERROR_ID = "item-rename-error";

/** Persist a new display title; returns updated item or undefined on alerted failure. */
export async function renameItemTitle(
  alerts: AlertsApi,
  itemId: string,
  nextTitle: string,
): Promise<ItemFile | undefined> {
  const title = nextTitle.trim();
  if (!title) {
    return undefined;
  }
  return runWithBusyAlert(alerts, {
    busyId: ITEM_RENAME_BUSY_ID,
    errorId: ITEM_RENAME_ERROR_ID,
    label: "Переименовываю…",
    run: () => getCollectorService().items.updateItem(itemId, { title }),
  });
}
