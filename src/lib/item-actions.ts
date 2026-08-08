import type { ItemFile } from "@collector/shared";
import type { AlertsApi } from "../components/alerts/alert-store";
import { runWithBusyAlert } from "../components/alerts/run-with-busy-alert";
import { getCollectorService } from "../services/collector-client";

export const ITEM_RENAME_BUSY_ID = "item-rename-busy";
export const ITEM_RENAME_ERROR_ID = "item-rename-error";
export const ITEM_MOVE_BUSY_ID = "item-move-busy";
export const ITEM_MOVE_ERROR_ID = "item-move-error";

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

/** Move item into folderPath; returns updated item or undefined on alerted failure. */
export async function moveItemToFolder(
  alerts: AlertsApi,
  itemId: string,
  folderPath: string,
): Promise<ItemFile | undefined> {
  return runWithBusyAlert(alerts, {
    busyId: ITEM_MOVE_BUSY_ID,
    errorId: ITEM_MOVE_ERROR_ID,
    label: "Перемещаю…",
    run: () =>
      getCollectorService().folders.moveItemToFolderPath(itemId, folderPath),
  });
}
