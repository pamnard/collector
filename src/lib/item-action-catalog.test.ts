import { describe, expect, it } from "vitest";
import {
  ITEM_ACTION_ORDER,
  groupItemActions,
  isItemActionEnabled,
  listEnabledItemActions,
  type ItemActionDef,
} from "./item-action-catalog";

describe("item-action-catalog", () => {
  it("hides import until host discover reports candidates", () => {
    expect(listEnabledItemActions().map((action) => action.id)).toEqual([
      "move",
      "rename",
      "lint",
      "delete",
    ]);
    expect(
      listEnabledItemActions({ importAvailable: true }).map(
        (action) => action.id,
      ),
    ).toEqual(["move", "rename", "import", "lint", "delete"]);
    expect(
      listEnabledItemActions({ importAvailable: true }).map(
        (action) => action.label,
      ),
    ).toContain("Импорт");
  });

  it("enables catalog ids with import gated", () => {
    expect(isItemActionEnabled("move")).toBe(true);
    expect(isItemActionEnabled("import")).toBe(false);
    expect(isItemActionEnabled("import", { importAvailable: true })).toBe(true);
    expect(ITEM_ACTION_ORDER.map((action) => action.id)).toEqual([
      "move",
      "rename",
      "import",
      "lint",
      "delete",
    ]);
  });

  it("groupItemActions keeps same-group items in one section", () => {
    const actions: ItemActionDef[] = [
      { id: "rename", group: "modify", label: "Переименовать" },
      { id: "import", group: "modify", label: "Импорт" },
      { id: "lint", group: "modify", label: "Линт файла" },
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
