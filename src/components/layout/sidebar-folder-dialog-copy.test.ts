import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultCreateFolderParentPath,
  folderDeleteDialogCopy,
  folderLeafNameDialogCopy,
} from "./sidebar-folder-dialog-copy.ts";

describe("folderLeafNameDialogCopy", () => {
  it("builds rename copy from leaf name", () => {
    assert.deepEqual(
      folderLeafNameDialogCopy({ kind: "rename", path: "projects/notes" }),
      {
        title: "Переименовать папку",
        description: "Новое имя для «notes».",
        confirmLabel: "Сохранить",
        initialValue: "notes",
        placeholder: undefined,
      },
    );
  });

  it("builds create-child copy from parent path", () => {
    assert.deepEqual(
      folderLeafNameDialogCopy({ kind: "create", path: "projects" }),
      {
        title: "Новая папка",
        description: "Дочерняя папка внутри «projects».",
        confirmLabel: "Создать",
        initialValue: "",
        placeholder: "Имя папки",
      },
    );
  });
});

describe("folderDeleteDialogCopy", () => {
  it("uses leaf as title and full path in description", () => {
    assert.deepEqual(folderDeleteDialogCopy("a/b/c"), {
      title: "c",
      description:
        "Папка «a/b/c» и все вложенные папки и элементы будут удалены без возможности восстановления.",
    });
  });
});

describe("defaultCreateFolderParentPath", () => {
  it("uses active folder path when filter is folder", () => {
    assert.equal(
      defaultCreateFolderParentPath({ type: "folder", folderPath: "inbox" }),
      "inbox",
    );
  });

  it("uses empty parent when filter is not a folder", () => {
    assert.equal(defaultCreateFolderParentPath("all"), "");
    assert.equal(
      defaultCreateFolderParentPath({ type: "tag", tagId: "t1" }),
      "",
    );
  });
});
