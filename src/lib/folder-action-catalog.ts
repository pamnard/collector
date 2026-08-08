export type FolderActionId = "new-note" | "new-folder" | "rename" | "move";

/** Epic #282 groups that currently have real handlers. */
export type FolderActionGroup = "create" | "manage" | "modify";

export type FolderActionDef = {
  id: FolderActionId;
  group: FolderActionGroup;
  label: string;
};

/** Stable catalog order: Create → Manage → Modify (epic #282). */
export const FOLDER_ACTION_ORDER: readonly FolderActionDef[] = [
  { id: "new-note", group: "create", label: "Новая заметка" },
  { id: "new-folder", group: "create", label: "Новая папка" },
  { id: "move", group: "manage", label: "Переместить папку в…" },
  { id: "rename", group: "modify", label: "Переименовать" },
] as const;

export function isFolderActionEnabled(
  _id: FolderActionId,
  _folderPath: string,
): boolean {
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
