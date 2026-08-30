import type { AlertsApi } from "../alerts/alert-store";
import { runWithBusyAlert } from "../alerts/run-with-busy-alert";
import {
  clearFolderNavFilterAfterDelete,
  createChildFolder,
  deleteFolderAt,
  moveFolderTo,
  renameFolderLeaf,
  rewriteFolderNavFilterAfterMove,
} from "../../lib/folder-actions";
import type { NavFilter } from "../../types/ui";
import {
  FOLDER_COPY_PATH_ALERT_ID,
  FOLDER_CREATE_BUSY_ID,
  FOLDER_CREATE_ERROR_ID,
  FOLDER_DELETE_BUSY_ID,
  FOLDER_DELETE_ERROR_ID,
  FOLDER_MOVE_BUSY_ID,
  FOLDER_MOVE_ERROR_ID,
  FOLDER_RENAME_BUSY_ID,
  FOLDER_RENAME_ERROR_ID,
} from "./sidebar-folder-alert-ids";

export async function copyFolderPathToClipboard(
  alerts: AlertsApi,
  path: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    alerts.upsert(FOLDER_COPY_PATH_ALERT_ID, {
      tone: "info",
      message: "Путь скопирован",
      onDismiss: () => alerts.dismiss(FOLDER_COPY_PATH_ALERT_ID),
    });
    window.setTimeout(() => alerts.dismiss(FOLDER_COPY_PATH_ALERT_ID), 2000);
  } catch (err: unknown) {
    console.error("Folder path copy failed", {
      error: err,
      folderPath: path,
    });
    alerts.upsert(FOLDER_COPY_PATH_ALERT_ID, {
      tone: "danger",
      message: "Не удалось скопировать путь",
      onDismiss: () => alerts.dismiss(FOLDER_COPY_PATH_ALERT_ID),
    });
  }
}

export async function confirmMoveFolder(options: {
  alerts: AlertsApi;
  activeFilter: NavFilter;
  onSelect: (filter: NavFilter) => void;
  folderPath: string;
  newParentPath: string;
}): Promise<void> {
  const newPath = await runWithBusyAlert(options.alerts, {
    busyId: FOLDER_MOVE_BUSY_ID,
    errorId: FOLDER_MOVE_ERROR_ID,
    label: "Перемещаю папку и всё содержимое…",
    run: () => moveFolderTo(options.folderPath, options.newParentPath),
  });
  if (newPath === undefined) {
    return;
  }
  const next = rewriteFolderNavFilterAfterMove(
    options.activeFilter,
    options.folderPath,
    newPath,
  );
  if (next) {
    options.onSelect(next);
  }
}

export async function confirmRenameFolder(options: {
  alerts: AlertsApi;
  activeFilter: NavFilter;
  onSelect: (filter: NavFilter) => void;
  folderPath: string;
  newLeafName: string;
}): Promise<string | undefined> {
  const newPath = await runWithBusyAlert(options.alerts, {
    busyId: FOLDER_RENAME_BUSY_ID,
    errorId: FOLDER_RENAME_ERROR_ID,
    label: "Переименовываю папку и всё содержимое…",
    run: () => renameFolderLeaf(options.folderPath, options.newLeafName),
  });
  if (newPath === undefined) {
    return undefined;
  }
  const next = rewriteFolderNavFilterAfterMove(
    options.activeFilter,
    options.folderPath,
    newPath,
  );
  if (next) {
    options.onSelect(next);
  }
  return newPath;
}

export async function confirmCreateChildFolder(options: {
  alerts: AlertsApi;
  onSelect: (filter: NavFilter) => void;
  parentPath: string;
  leafName: string;
}): Promise<string | undefined> {
  const newPath = await runWithBusyAlert(options.alerts, {
    busyId: FOLDER_CREATE_BUSY_ID,
    errorId: FOLDER_CREATE_ERROR_ID,
    label: "Создаю папку…",
    run: () => createChildFolder(options.parentPath, options.leafName),
  });
  if (newPath === undefined) {
    return undefined;
  }
  options.onSelect({ type: "folder", folderPath: newPath });
  return newPath;
}

export async function confirmDeleteFolder(options: {
  alerts: AlertsApi;
  activeFilter: NavFilter;
  onSelect: (filter: NavFilter) => void;
  folderPath: string;
}): Promise<void> {
  await runWithBusyAlert(options.alerts, {
    busyId: FOLDER_DELETE_BUSY_ID,
    errorId: FOLDER_DELETE_ERROR_ID,
    label: "Удаляю папку и всё содержимое…",
    rethrow: true,
    run: () => deleteFolderAt(options.folderPath),
  });
  const next = clearFolderNavFilterAfterDelete(
    options.activeFilter,
    options.folderPath,
  );
  if (next) {
    options.onSelect(next);
  }
}
