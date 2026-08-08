import { describe, expect, it } from "vitest";
import {
  ITEM_ACTION_ORDER,
  groupItemActions,
  isItemActionEnabled,
  listEnabledItemActions,
  type ItemActionDef,
} from "./item-action-catalog";

describe("item-action-catalog", () => {
  it("lists delete in modify group", () => {
    const actions = listEnabledItemActions();
    expect(actions.map((action) => action.id)).toEqual(["delete"]);
    expect(actions.map((action) => action.group)).toEqual(["modify"]);
    expect(actions[0]?.label).toBe("Удалить");
  });

  it("enables catalog ids", () => {
    expect(isItemActionEnabled("delete")).toBe(true);
    expect(ITEM_ACTION_ORDER.map((action) => action.id)).toEqual(["delete"]);
  });

  it("groupItemActions keeps same-group items in one section", () => {
    const actions: ItemActionDef[] = [
      { id: "delete", group: "modify", label: "Удалить" },
    ];
    expect(groupItemActions(actions)).toEqual([actions]);
  });

  it("groupItemActions splits when group changes", () => {
    // Simulate a future second group without expanding ItemActionId yet.
    const actions = [
      { id: "delete", group: "modify", label: "Удалить" },
      { id: "delete", group: "manage" as ItemActionDef["group"], label: "Другое" },
    ];
    expect(groupItemActions(actions)).toEqual([
      [{ id: "delete", group: "modify", label: "Удалить" }],
      [{ id: "delete", group: "manage", label: "Другое" }],
    ]);
  });
});
