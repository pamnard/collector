import { INBOX_FOLDER_NAME } from "@collector/shared";
import { isFolderFilter, type NavFilter } from "../types/ui";

/** Folder path for a dashboard file drop: active folder, else Inbox. */
export function resolveDropTargetFolder(activeFilter: NavFilter): string {
  if (isFolderFilter(activeFilter)) {
    const path = activeFilter.folderPath.trim();
    if (path) {
      return path;
    }
  }
  return INBOX_FOLDER_NAME;
}
