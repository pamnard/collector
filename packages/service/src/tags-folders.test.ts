import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tag } from "@collector/shared";

const listTagsWithCounts = vi.fn();
const createTagOnVault = vi.fn();
const listFolderTreeFromIndex = vi.fn();
const moveItemToFolder = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    listTagsWithCounts: (...args: unknown[]) => listTagsWithCounts(...args),
    createTag: (...args: unknown[]) => createTagOnVault(...args),
    listFolderTreeFromIndex: (...args: unknown[]) =>
      listFolderTreeFromIndex(...args),
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

  beforeEach(() => {
    listTagsWithCounts.mockReset();
    createTagOnVault.mockReset();
    listFolderTreeFromIndex.mockReset();
    moveItemToFolder.mockReset();
    kickoff.mockReset();
  });

  function createService() {
    return createTagsFoldersService({
      resolveActiveVault: async () => ({ vault: vault as never, path: "/vault" }),
      getContext: () => ctx,
      kickoffVaultIndexSync: kickoff,
      addVaultSyncListener: () => () => {},
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
    listFolderTreeFromIndex.mockResolvedValue([
      { name: "Inbox", path: "Inbox", item_count: 1, children: [] },
    ]);
    moveItemToFolder.mockResolvedValue({ id: "a.md" });

    const service = createService();
    const tree = await service.listFolderTree();
    const moved = await service.moveItemToFolderPath("a.md", "Inbox");

    expect(listFolderTreeFromIndex).toHaveBeenCalledWith(ctx, "/vault", "v1");
    expect(tree[0]?.path).toBe("Inbox");
    expect(moveItemToFolder).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "v1",
      "a.md",
      "Inbox",
    );
    expect(moved).toEqual({ id: "a.md" });
  });
});
