import { isInboxFolderName } from "@collector/shared";

export type FolderActionId =
  | "new-note"
  | "new-folder"
  | "rename"
  | "move"
  | "copy-path"
  | "delete";

export type FolderActionGroup = "create" | "manage" | "modify";

export type FolderActionDef = {
  id: FolderActionId;
  group: FolderActionGroup;
  label: string;
};

/** Stable catalog order: Create → Manage → Modify. */
export const FOLDER_ACTION_ORDER: readonly FolderActionDef[] = [
  { id: "new-note", group: "create", label: "Новая заметка" },
  { id: "new-folder", group: "create", label: "Новая папка" },
  { id: "move", group: "manage", label: "Переместить папку в…" },
  { id: "copy-path", group: "manage", label: "Копировать путь" },
  { id: "rename", group: "modify", label: "Переименовать" },
  { id: "delete", group: "modify", label: "Удалить" },
] as const;

function isTopLevelInboxFolder(folderPath: string): boolean {
  return !folderPath.includes("/") && isInboxFolderName(folderPath);
}

export function isFolderActionEnabled(
  id: FolderActionId,
  folderPath: string,
): boolean {
  if (id === "delete" && isTopLevelInboxFolder(folderPath)) {
    return false;
  }
  return true;
}

export function listEnabledFolderActions(
  folderPath: string,
): FolderActionDef[] {
  return FOLDER_ACTION_ORDER.filter((action) =>
    isFolderActionEnabled(action.id, folderPath),
  );
}

/** Consecutive same-group actions become one section (for menu separators). */
export function groupFolderActions(
  actions: readonly FolderActionDef[],
): FolderActionDef[][] {
  const sections: FolderActionDef[][] = [];
  for (const action of actions) {
    const last = sections[sections.length - 1];
    if (last !== undefined && last[0]?.group === action.group) {
      last.push(action);
    } else {
      sections.push([action]);
    }
  }
  return sections;
}
