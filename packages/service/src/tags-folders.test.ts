import { beforeEach, describe, expect, it, vi } from "vitest";

const listTagsWithCounts = vi.fn();
const createFolderOnVault = vi.fn();
const renameFolderOnVault = vi.fn();
const deleteFolderOnVault = vi.fn();
const reconcileFolderTreeFromDisk = vi.fn();
const listFolderItemsOnVault = vi.fn();
const moveItemToFolder = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    listTagsWithCounts: (...args: unknown[]) => listTagsWithCounts(...args),
    createFolder: (...args: unknown[]) => createFolderOnVault(...args),
    renameFolder: (...args: unknown[]) => renameFolderOnVault(...args),
    deleteFolder: (...args: unknown[]) => deleteFolderOnVault(...args),
    reconcileFolderTreeFromDisk: (...args: unknown[]) =>
      reconcileFolderTreeFromDisk(...args),
    listFolderItems: (...args: unknown[]) => listFolderItemsOnVault(...args),
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
    createFolderOnVault.mockReset();
    renameFolderOnVault.mockReset();
    deleteFolderOnVault.mockReset();
    reconcileFolderTreeFromDisk.mockReset();
    listFolderItemsOnVault.mockReset();
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

  it("exposes list-only tags surface (#842)", () => {
    const service = createService();
    expect(service).not.toHaveProperty("createTag");
    expect(service).not.toHaveProperty("deleteTag");
    expect(service).not.toHaveProperty("updateTagRecord");
    expect(typeof service.listTags).toBe("function");
    expect(typeof service.subscribeTags).toBe("function");
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

  it("listFolderItems kicks sync and delegates (#844)", async () => {
    const items = [{ id: "Parent/a.md", folder_path: "Parent", title: "A" }];
    listFolderItemsOnVault.mockResolvedValue(items);

    const result = await createService().listFolderItems("Parent");

    expect(kickoff).toHaveBeenCalledWith("v1", "/vault");
    expect(listFolderItemsOnVault).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "v1",
      "Parent",
    );
    expect(result).toEqual(items);
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

  it("kicks index sync only after folder mutators finish (#758)", async () => {
    createFolderOnVault.mockResolvedValue("Projects/New");
    renameFolderOnVault.mockResolvedValue("Projects/Renamed");
    deleteFolderOnVault.mockResolvedValue(undefined);
    moveItemToFolder.mockResolvedValue({
      id: "Inbox/a.md",
      folder_path: "Inbox",
    });

    const service = createService();

    await service.renameFolder("Projects/Old", "Projects/Renamed");
    expect(renameFolderOnVault).toHaveBeenCalledTimes(1);
    expect(kickoff).toHaveBeenCalledTimes(1);
    expect(kickoff.mock.invocationCallOrder[0]).toBeGreaterThan(
      renameFolderOnVault.mock.invocationCallOrder[0]!,
    );
    expect(onVaultPresentationChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
      kickoff.mock.invocationCallOrder[0]!,
    );

    kickoff.mockClear();
    onVaultPresentationChanged.mockClear();
    await service.createFolder("Projects/New");
    expect(kickoff.mock.invocationCallOrder[0]).toBeGreaterThan(
      createFolderOnVault.mock.invocationCallOrder[0]!,
    );

    kickoff.mockClear();
    await service.deleteFolder("Projects/New");
    expect(kickoff.mock.invocationCallOrder[0]).toBeGreaterThan(
      deleteFolderOnVault.mock.invocationCallOrder[0]!,
    );

    kickoff.mockClear();
    await service.moveItemToFolderPath("Projects/a.md", "Inbox");
    expect(kickoff.mock.invocationCallOrder[0]).toBeGreaterThan(
      moveItemToFolder.mock.invocationCallOrder[0]!,
    );
  });

  it("does not kick sync when renameFolder fails before rewrite completes (#758)", async () => {
    renameFolderOnVault.mockRejectedValue(
      new Error("UNIQUE constraint failed: Items.id"),
    );

    await expect(
      createService().renameFolder("Projects/Old", "Projects/New"),
    ).rejects.toThrow("UNIQUE constraint failed: Items.id");

    expect(kickoff).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("renameFolder race repro: pre-mutation kickoff would collide with rewrite (#758)", async () => {
    const events: string[] = [];
    kickoff.mockImplementation(() => {
      events.push("kickoff");
    });
    renameFolderOnVault.mockImplementation(async () => {
      if (events.includes("kickoff")) {
        throw new Error("UNIQUE constraint failed: Items.id");
      }
      events.push("rename");
      return "Projects/Renamed";
    });

    await expect(
      createService().renameFolder("Projects/Old", "Projects/Renamed"),
    ).resolves.toBe("Projects/Renamed");

    expect(events).toEqual(["rename", "kickoff"]);
  });
});
