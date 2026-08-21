import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tag } from "@collector/shared";

const listTagsWithCounts = vi.fn();
const createTagOnVault = vi.fn();
const createFolderOnVault = vi.fn();
const renameFolderOnVault = vi.fn();
const deleteFolderOnVault = vi.fn();
const reconcileFolderTreeFromDisk = vi.fn();
const moveItemToFolder = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    listTagsWithCounts: (...args: unknown[]) => listTagsWithCounts(...args),
    createTag: (...args: unknown[]) => createTagOnVault(...args),
    createFolder: (...args: unknown[]) => createFolderOnVault(...args),
    renameFolder: (...args: unknown[]) => renameFolderOnVault(...args),
    deleteFolder: (...args: unknown[]) => deleteFolderOnVault(...args),
    reconcileFolderTreeFromDisk: (...args: unknown[]) =>
      reconcileFolderTreeFromDisk(...args),
    moveItemToFolder: (...args: unknown[]) => moveItemToFolder(...args),
  };
});

import { createTagsFoldersService } from "./tags-folders.js";

describe("createTagsFoldersService", () => {
  const vault = {
    id: "v1",
    name: "Vault",
    is_default: true,
    created_at: "a",
    updated_at: "a",
  };
  const ctx = { fs: {}, index: {} } as never;
  const kickoff = vi.fn();
  const onVaultPresentationChanged = vi.fn();

  beforeEach(() => {
    listTagsWithCounts.mockReset();
    createTagOnVault.mockReset();
    createFolderOnVault.mockReset();
    renameFolderOnVault.mockReset();
    deleteFolderOnVault.mockReset();
    reconcileFolderTreeFromDisk.mockReset();
    moveItemToFolder.mockReset();
    kickoff.mockReset();
    onVaultPresentationChanged.mockReset();
  });

  function createService() {
    return createTagsFoldersService({
      resolveActiveVault: async () => ({ vault: vault as never, path: "/vault" }),
      getContext: () => ctx,
      kickoffVaultIndexSync: kickoff,
      addVaultSyncListener: () => () => {},
      onVaultPresentationChanged,
    });
  }

  it("listTags kicks sync and returns tag counts", async () => {
    const tags = [
      {
        id: "t1",
        vault_id: "v1",
        name: "x",
        color: null,
        created_at: "a",
        updated_at: "a",
        item_count: 2,
      },
    ];
    listTagsWithCounts.mockResolvedValue(tags);

    const result = await createService().listTags();

    expect(kickoff).toHaveBeenCalledWith("v1", "/vault");
    expect(listTagsWithCounts).toHaveBeenCalledWith(ctx, "v1");
    expect(result).toEqual(tags);
  });

  it("createTag kicks sync and delegates to vault op", async () => {
    const created: Tag = {
      id: "t1",
      vault_id: "v1",
      name: "n",
      color: null,
      created_at: "a",
      updated_at: "a",
    };
    createTagOnVault.mockResolvedValue(created);

    const result = await createService().createTag({ name: "n" });

    expect(kickoff).toHaveBeenCalledWith("v1", "/vault");
    expect(createTagOnVault).toHaveBeenCalledWith(ctx, "/vault", "v1", {
      name: "n",
    });
    expect(result).toEqual(created);
  });

  it("listFolderTree and moveItemToFolderPath delegate", async () => {
    reconcileFolderTreeFromDisk.mockResolvedValue([
      { name: "Inbox", path: "Inbox", item_count: 1, children: [] },
    ]);
    moveItemToFolder.mockResolvedValue({ id: "Inbox/a.md", folder_path: "Inbox" });

    const service = createService();
    const tree = await service.listFolderTree();
    const moved = await service.moveItemToFolderPath("Projects/a.md", "Inbox");

    expect(reconcileFolderTreeFromDisk).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "v1",
    );
    expect(tree[0]?.path).toBe("Inbox");
    expect(moveItemToFolder).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "v1",
      "Projects/a.md",
      "Inbox",
    );
    expect(moved).toEqual({ id: "Inbox/a.md", folder_path: "Inbox" });
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId: "v1",
      kind: "itemMoved",
      itemId: "Inbox/a.md",
      fromFolderPath: "Projects",
      toFolderPath: "Inbox",
    });
  });

  it("emits folderChanged on create/rename/delete folder (#756)", async () => {
    createFolderOnVault.mockResolvedValue("Projects/New");
    renameFolderOnVault.mockResolvedValue("Projects/Renamed");
    deleteFolderOnVault.mockResolvedValue(undefined);

    const service = createService();
    await service.createFolder("Projects/New");
    await service.renameFolder("Projects/New", "Projects/Renamed");
    await service.deleteFolder("Projects/Renamed");

    expect(onVaultPresentationChanged).toHaveBeenNthCalledWith(1, {
      vaultId: "v1",
      kind: "folderChanged",
      folderPath: "Projects/New",
    });
    expect(onVaultPresentationChanged).toHaveBeenNthCalledWith(2, {
      vaultId: "v1",
      kind: "folderChanged",
      folderPath: "Projects/Renamed",
    });
    expect(onVaultPresentationChanged).toHaveBeenNthCalledWith(3, {
      vaultId: "v1",
      kind: "folderChanged",
      folderPath: "Projects/Renamed",
    });
  });
});
