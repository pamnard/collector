import type { ExtractCandidate } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { AlertsApi } from "../components/alerts/alert-store";
import { runWithBusyAlert } from "../components/alerts/run-with-busy-alert";
import { getCollectorService } from "../services/collector-client";

export const ITEM_RENAME_BUSY_ID = "item-rename-busy";
export const ITEM_RENAME_ERROR_ID = "item-rename-error";
export const ITEM_MOVE_BUSY_ID = "item-move-busy";
export const ITEM_MOVE_ERROR_ID = "item-move-error";
export const ITEM_LINT_BUSY_ID = "item-lint-busy";
export const ITEM_LINT_ERROR_ID = "item-lint-error";
export const ITEM_IMPORT_BUSY_ID = "item-import-busy";
export const ITEM_IMPORT_ERROR_ID = "item-import-error";
export const ITEM_IMPORT_NOTHING_MESSAGE =
  "Нечего импортировать: в заметке нет подходящих ссылок";

export type ItemImportAction =
  | { kind: "none" }
  | { kind: "one"; candidate: ExtractCandidate }
  | { kind: "many"; candidates: ExtractCandidate[] };

export function resolveItemImportAction(
  candidates: ExtractCandidate[],
): ItemImportAction {
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate) {
      return { kind: "none" };
    }
    return { kind: "one", candidate };
  }
  return { kind: "many", candidates };
}

export function formatImportCandidateLabel(candidate: ExtractCandidate): string {
  const shortcode = candidate.meta?.shortcode?.trim();
  if (shortcode) {
    return `${candidate.extractorId}: ${shortcode}`;
  }
  return `${candidate.extractorId}: ${candidate.url}`;
}

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

/**
 * Run host-side markdown normalize without opening the editor.
 * Host writes only when normalized text differs from disk.
 */
export async function lintItemFile(
  alerts: AlertsApi,
  itemId: string,
): Promise<ItemFile | undefined> {
  return runWithBusyAlert(alerts, {
    busyId: ITEM_LINT_BUSY_ID,
    errorId: ITEM_LINT_ERROR_ID,
    label: "Линтую…",
    run: async () => {
      const raw = await getCollectorService().items.getItemSource(itemId);
      return getCollectorService().items.updateItemSource(itemId, raw);
    },
  });
}

/**
 * Silent host discover for menu visibility — no AlertStack busy toast.
 * Same candidates the import action will run.
 */
export async function peekItemImportCandidates(
  itemId: string,
): Promise<ExtractCandidate[]> {
  return getCollectorService().extract.discoverExtractCandidates(itemId);
}

/** Run explicit extract/import for one candidate; returns updated item. */
export async function runItemImport(
  alerts: AlertsApi,
  itemId: string,
  candidate: ExtractCandidate,
): Promise<ItemFile | undefined> {
  return runWithBusyAlert(alerts, {
    busyId: ITEM_IMPORT_BUSY_ID,
    errorId: ITEM_IMPORT_ERROR_ID,
    label: "Импортирую…",
    run: async () => {
      await getCollectorService().extract.extractItemCandidate(
        itemId,
        candidate,
      );
      const result = await getCollectorService().items.getItemById(itemId);
      return result.item;
    },
  });
}
