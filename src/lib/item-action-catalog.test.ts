import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ITEM_ACTION_ORDER,
  groupItemActions,
  isItemActionEnabled,
  listEnabledItemActions,
  type ItemActionDef,
} from "./item-action-catalog.ts";

describe("item-action-catalog", () => {
  it("hides import until host discover reports candidates", () => {
    assert.deepEqual(
      listEnabledItemActions().map((action) => action.id),
      ["move", "rename", "exportPdf", "lint", "delete"],
    );
    assert.deepEqual(
      listEnabledItemActions({ importAvailable: true }).map(
        (action) => action.id,
      ),
      ["move", "rename", "import", "exportPdf", "lint", "delete"],
    );
    assert.equal(
      listEnabledItemActions({ importAvailable: true })
        .map((action) => action.label)
        .includes("Импорт"),
      true,
    );
    assert.equal(
      listEnabledItemActions()
        .map((action) => action.label)
        .includes("Экспортировать в PDF"),
      true,
    );
  });

  it("enables catalog ids with import gated", () => {
    assert.equal(isItemActionEnabled("move"), true);
    assert.equal(isItemActionEnabled("import"), false);
    assert.equal(isItemActionEnabled("import", { importAvailable: true }), true);
    assert.equal(isItemActionEnabled("exportPdf"), true);
    assert.deepEqual(
      ITEM_ACTION_ORDER.map((action) => action.id),
      ["move", "rename", "import", "exportPdf", "lint", "delete"],
    );
  });

  it("groupItemActions keeps same-group items in one section", () => {
    const actions: ItemActionDef[] = [
      { id: "rename", group: "modify", label: "Переименовать" },
      { id: "import", group: "modify", label: "Импорт" },
      { id: "lint", group: "modify", label: "Линт файла" },
      { id: "delete", group: "modify", label: "Удалить" },
    ];
    assert.deepEqual(groupItemActions(actions), [actions]);
  });

  it("groupItemActions splits when group changes", () => {
    const actions: ItemActionDef[] = [
      { id: "move", group: "manage", label: "Переместить файл в…" },
      { id: "delete", group: "modify", label: "Удалить" },
    ];
    assert.deepEqual(groupItemActions(actions), [
      [{ id: "move", group: "manage", label: "Переместить файл в…" }],
      [{ id: "delete", group: "modify", label: "Удалить" }],
    ]);
  });
});
