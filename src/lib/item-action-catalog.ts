export type ItemActionId =
  | "move"
  | "rename"
  | "import"
  | "lint"
  | "delete";

export type ItemActionGroup = "manage" | "modify";

export type ItemActionDef = {
  id: ItemActionId;
  group: ItemActionGroup;
  label: string;
};

/** Stable catalog order. More groups/actions land via #289 children. */
export const ITEM_ACTION_ORDER: readonly ItemActionDef[] = [
  { id: "move", group: "manage", label: "Переместить файл в…" },
  { id: "rename", group: "modify", label: "Переименовать" },
  { id: "import", group: "modify", label: "Импорт" },
  { id: "lint", group: "modify", label: "Линт файла" },
  { id: "delete", group: "modify", label: "Удалить" },
] as const;

export type ListItemActionsOptions = {
  /**
   * Host discover found at least one extract candidate for this item.
   * Import stays hidden until true (default false).
   */
  importAvailable?: boolean;
};

export function isItemActionEnabled(
  id: ItemActionId,
  options: ListItemActionsOptions = {},
): boolean {
  if (id === "import") {
    return options.importAvailable === true;
  }
  return true;
}

export function listEnabledItemActions(
  options: ListItemActionsOptions = {},
): ItemActionDef[] {
  return ITEM_ACTION_ORDER.filter((action) =>
    isItemActionEnabled(action.id, options),
  );
}

/** Consecutive same-group actions become one section (for menu separators). */
export function groupItemActions(
  actions: readonly ItemActionDef[],
): ItemActionDef[][] {
  const sections: ItemActionDef[][] = [];
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
