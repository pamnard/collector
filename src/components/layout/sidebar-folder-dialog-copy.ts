import { folderLeafName } from "@collector/shared";
import { isFolderFilter, type NavFilter } from "../../types/ui.ts";

export type SidebarFolderLeafDialog =
  | { kind: "rename"; path: string }
  | { kind: "create"; path: string };

export type FolderLeafNameDialogCopy = {
  title: string;
  description: string;
  confirmLabel: string;
  initialValue: string;
  placeholder: string | undefined;
};

export function folderLeafNameDialogCopy(
  dialog: SidebarFolderLeafDialog,
): FolderLeafNameDialogCopy {
  if (dialog.kind === "rename") {
    const leaf = folderLeafName(dialog.path);
    return {
      title: "Переименовать папку",
      description: `Новое имя для «${leaf}».`,
      confirmLabel: "Сохранить",
      initialValue: leaf,
      placeholder: undefined,
    };
  }
  return {
    title: "Новая папка",
    description: `Дочерняя папка внутри «${dialog.path}».`,
    confirmLabel: "Создать",
    initialValue: "",
    placeholder: "Имя папки",
  };
}

export function folderDeleteDialogCopy(folderPath: string): {
  title: string;
  description: string;
} {
  return {
    title: folderLeafName(folderPath),
    description: `Папка «${folderPath}» и все вложенные папки и элементы будут удалены без возможности восстановления.`,
  };
}

/** Parent path for the top-level "new folder" dialog — folder filter only. */
export function defaultCreateFolderParentPath(
  activeFilter: NavFilter,
): string {
  if (isFolderFilter(activeFilter)) {
    return activeFilter.folderPath;
  }
  return "";
}
