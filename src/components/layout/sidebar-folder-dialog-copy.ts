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

/** Same leaf rule as `folderLeafName` in folder-actions (kept local for node:test). */
function leafName(folderPath: string): string {
  const slash = folderPath.lastIndexOf("/");
  return slash === -1 ? folderPath : folderPath.slice(slash + 1);
}

export function folderLeafNameDialogCopy(
  dialog: SidebarFolderLeafDialog,
): FolderLeafNameDialogCopy {
  if (dialog.kind === "rename") {
    const leaf = leafName(dialog.path);
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
    title: leafName(folderPath),
    description: `Папка «${folderPath}» и все вложенные папки и элементы будут удалены без возможности восстановления.`,
  };
}

/** Parent path for the top-level "new folder" dialog — folder filter only. */
export function defaultCreateFolderParentPath(
  activeFilter:
    | "all"
    | { type: "folder"; folderPath: string }
    | { type: "tag"; tagId: string },
): string {
  if (typeof activeFilter === "object" && activeFilter.type === "folder") {
    return activeFilter.folderPath;
  }
  return "";
}
