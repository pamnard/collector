import { describe, expect, it } from "vitest";
import {
  FOLDER_ACTION_ORDER,
  groupFolderActions,
  isFolderActionEnabled,
  listEnabledFolderActions,
  type FolderActionDef,
} from "./folder-action-catalog";

describe("folder-action-catalog", () => {
  it("lists Create then Manage then Modify including delete", () => {
    const actions = listEnabledFolderActions("Work/Articles");
    expect(actions.map((action) => action.id)).toEqual([
      "new-note",
      "new-folder",
      "move",
      "rename",
      "delete",
    ]);
    expect(actions.map((action) => action.group)).toEqual([
      "create",
      "create",
      "manage",
      "modify",
      "modify",
    ]);
  });

  it("hides delete for top-level Inbox", () => {
    expect(isFolderActionEnabled("delete", "Inbox")).toBe(false);
    expect(isFolderActionEnabled("delete", "inbox")).toBe(false);
    expect(listEnabledFolderActions("Inbox").map((a) => a.id)).not.toContain(
      "delete",
    );
    expect(isFolderActionEnabled("delete", "Work")).toBe(true);
    expect(isFolderActionEnabled("delete", "Inbox/Nested")).toBe(true);
  });

  it("keeps other catalog ids enabled for ordinary folders and Inbox", () => {
    expect(isFolderActionEnabled("new-note", "Inbox")).toBe(true);
    expect(isFolderActionEnabled("new-folder", "Work")).toBe(true);
    expect(isFolderActionEnabled("move", "Inbox")).toBe(true);
    expect(isFolderActionEnabled("rename", "Work")).toBe(true);
    expect(FOLDER_ACTION_ORDER.map((action) => action.id).sort()).toEqual([
      "delete",
      "move",
      "new-folder",
      "new-note",
      "rename",
    ]);
  });

  it("groupFolderActions splits consecutive groups into sections", () => {
    const actions: FolderActionDef[] = [
      { id: "new-note", group: "create", label: "Новая заметка" },
      { id: "new-folder", group: "create", label: "Новая папка" },
      { id: "move", group: "manage", label: "Переместить папку в…" },
      { id: "rename", group: "modify", label: "Переименовать" },
      { id: "delete", group: "modify", label: "Удалить" },
    ];
    expect(groupFolderActions(actions)).toEqual([
      [
        { id: "new-note", group: "create", label: "Новая заметка" },
        { id: "new-folder", group: "create", label: "Новая папка" },
      ],
      [{ id: "move", group: "manage", label: "Переместить папку в…" }],
      [
        { id: "rename", group: "modify", label: "Переименовать" },
        { id: "delete", group: "modify", label: "Удалить" },
      ],
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
