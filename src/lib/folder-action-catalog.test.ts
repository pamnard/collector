import { describe, expect, it } from "vitest";
import {
  FOLDER_ACTION_ORDER,
  groupFolderActions,
  isFolderActionEnabled,
  listEnabledFolderActions,
  type FolderActionDef,
} from "./folder-action-catalog";

describe("folder-action-catalog", () => {
  it("lists move then rename (Manage before Modify)", () => {
    const actions = listEnabledFolderActions("Work/Articles");
    expect(actions.map((action) => action.id)).toEqual(["move", "rename"]);
    expect(actions.map((action) => action.group)).toEqual([
      "manage",
      "modify",
    ]);
  });

  it("keeps both catalog ids enabled for ordinary folders", () => {
    expect(isFolderActionEnabled("move", "Inbox")).toBe(true);
    expect(isFolderActionEnabled("rename", "Work")).toBe(true);
    expect(FOLDER_ACTION_ORDER.map((action) => action.id).sort()).toEqual([
      "move",
      "rename",
    ]);
  });

  it("groupFolderActions splits consecutive groups into sections", () => {
    const actions: FolderActionDef[] = [
      { id: "move", group: "manage", label: "Переместить папку в…" },
      { id: "rename", group: "modify", label: "Переименовать" },
    ];
    expect(groupFolderActions(actions)).toEqual([
      [{ id: "move", group: "manage", label: "Переместить папку в…" }],
      [{ id: "rename", group: "modify", label: "Переименовать" }],
    ]);
  });

  it("groupFolderActions keeps same-group items in one section", () => {
    const actions: FolderActionDef[] = [
      { id: "move", group: "manage", label: "A" },
      { id: "rename", group: "manage", label: "B" },
    ];
    expect(groupFolderActions(actions)).toEqual([actions]);
  });
});
