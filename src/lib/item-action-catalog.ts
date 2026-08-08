export type ItemActionId = "delete";

export type ItemActionGroup = "modify";

export type ItemActionDef = {
  id: ItemActionId;
  group: ItemActionGroup;
  label: string;
};

/** Stable catalog order. More groups/actions land via #289 children. */
export const ITEM_ACTION_ORDER: readonly ItemActionDef[] = [
  { id: "delete", group: "modify", label: "Удалить" },
] as const;

export function isItemActionEnabled(_id: ItemActionId): boolean {
  return true;
}

export function listEnabledItemActions(): ItemActionDef[] {
  return ITEM_ACTION_ORDER.filter((action) => isItemActionEnabled(action.id));
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
