import { describe, expect, it } from "vitest";
import {
  ITEM_ACTION_ORDER,
  groupItemActions,
  isItemActionEnabled,
  listEnabledItemActions,
  type ItemActionDef,
} from "./item-action-catalog";

describe("item-action-catalog", () => {
  it("lists move then rename and delete with manage before modify", () => {
    const actions = listEnabledItemActions();
    expect(actions.map((action) => action.id)).toEqual([
      "move",
      "rename",
      "delete",
    ]);
    expect(actions.map((action) => action.group)).toEqual([
      "manage",
      "modify",
      "modify",
    ]);
    expect(actions.map((action) => action.label)).toEqual([
      "Переместить файл в…",
      "Переименовать",
      "Удалить",
    ]);
  });

  it("enables catalog ids", () => {
    expect(isItemActionEnabled("move")).toBe(true);
    expect(isItemActionEnabled("rename")).toBe(true);
    expect(isItemActionEnabled("delete")).toBe(true);
    expect(ITEM_ACTION_ORDER.map((action) => action.id)).toEqual([
      "move",
      "rename",
      "delete",
    ]);
  });

  it("groupItemActions keeps same-group items in one section", () => {
    const actions: ItemActionDef[] = [
      { id: "rename", group: "modify", label: "Переименовать" },
      { id: "delete", group: "modify", label: "Удалить" },
    ];
    expect(groupItemActions(actions)).toEqual([actions]);
  });

  it("groupItemActions splits when group changes", () => {
    const actions: ItemActionDef[] = [
      { id: "move", group: "manage", label: "Переместить файл в…" },
      { id: "delete", group: "modify", label: "Удалить" },
    ];
    expect(groupItemActions(actions)).toEqual([
      [{ id: "move", group: "manage", label: "Переместить файл в…" }],
      [{ id: "delete", group: "modify", label: "Удалить" }],
    ]);
  });
});
