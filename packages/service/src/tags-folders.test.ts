import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  joinSegments,
  readItemFile,
  upsertItem,
  writeItemRawMarkdown,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { runMigrations } from "@collector/db";
import type { VaultMeta } from "@collector/shared";
import { BetterSqliteMigrator } from "../../db/src/testing/better-sqlite.js";
import { createTagsFoldersService } from "./tags-folders.js";

function noteMarkdown(args: {
  tagsYaml: string;
  contentRevision: number;
  createdAt: string;
}): string {
  return [
    "---",
    "title: Note",
    "type: note",
    args.tagsYaml,
    `content_revision: ${args.contentRevision}`,
    `created: ${args.createdAt}`,
    `updated: ${args.createdAt}`,
    "---",
    "",
    "body",
    "",
  ].join("\n");
}

describe("createTagsFoldersService", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openVault(): Promise<{
    ctx: VaultContext;
    meta: VaultMeta;
    path: string;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tags-folders-svc-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  function createService(args: {
    meta: VaultMeta;
    path: string;
    ctx: VaultContext;
    kickoff?: ReturnType<typeof vi.fn>;
    onVaultPresentationChanged?: ReturnType<typeof vi.fn>;
  }) {
    const kickoff = args.kickoff ?? vi.fn();
    const onVaultPresentationChanged =
      args.onVaultPresentationChanged ?? vi.fn();
    const service = createTagsFoldersService({
      resolveActiveVault: async () => ({
        vault: args.meta,
        path: args.path,
      }),
      getContext: () => args.ctx,
      kickoffVaultIndexSync: kickoff,
      addVaultSyncListener: () => () => {},
      onVaultPresentationChanged,
    });
    return { service, kickoff, onVaultPresentationChanged };
  }

  it("exposes list-only tags surface (#842)", async () => {
    const { ctx, meta, path } = await openVault();
    const { service } = createService({ ctx, meta, path });

    expect(service).not.toHaveProperty("createTag");
    expect(service).not.toHaveProperty("deleteTag");
    expect(service).not.toHaveProperty("updateTagRecord");
    expect(typeof service.listTags).toBe("function");
    expect(typeof service.subscribeTags).toBe("function");
  });

  it("listTags returns derived tag counts from the vault index and kicks sync", async () => {
    const { ctx, meta, path } = await openVault();
    const { service, kickoff } = createService({ ctx, meta, path });

    const itemId = `${crypto.randomUUID()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });

    expect(await service.listTags()).toEqual([]);
    expect(kickoff).toHaveBeenCalledWith(meta.id, path);

    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      noteMarkdown({
        tagsYaml: "tags:\n  - Research",
        contentRevision: 2,
        createdAt,
      }),
    );

    kickoff.mockClear();
    const tags = await service.listTags();
    expect(kickoff).toHaveBeenCalledWith(meta.id, path);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe("research");
    expect(tags[0]?.item_count).toBe(1);
  });

  it("create/rename/delete folder persist on disk + index and emit after kickoff (#756/#758)", async () => {
    const { ctx, meta, path } = await openVault();
    const events: string[] = [];
    const kickoff = vi.fn(() => {
      events.push("kickoff");
    });
    const onVaultPresentationChanged = vi.fn(
      (payload: { kind: string; folderPath?: string }) => {
        events.push(`presentation:${payload.kind}:${payload.folderPath ?? ""}`);
      },
    );
    const { service } = createService({
      ctx,
      meta,
      path,
      kickoff,
      onVaultPresentationChanged,
    });

    const created = await service.createFolder("Projects/New");
    expect(created).toBe("Projects/New");
    expect(await fs.exists(joinSegments(path, "Projects/New"))).toBe(true);
    expect(events).toEqual([
      "kickoff",
      "presentation:folderChanged:Projects/New",
    ]);

    events.length = 0;
    const renamed = await service.renameFolder("Projects/New", "Projects/Renamed");
    expect(renamed).toBe("Projects/Renamed");
    expect(await fs.exists(joinSegments(path, "Projects/Renamed"))).toBe(true);
    expect(await fs.exists(joinSegments(path, "Projects/New"))).toBe(false);
    const treeAfterRename = await service.listFolderTree();
    const projects = treeAfterRename.find((node) => node.path === "Projects");
    expect(
      projects?.children.some((child) => child.path === "Projects/Renamed"),
    ).toBe(true);
    expect(events[0]).toBe("kickoff");
    expect(events).toContain("presentation:folderChanged:Projects/Renamed");

    events.length = 0;
    await service.deleteFolder("Projects/Renamed");
    expect(await fs.exists(joinSegments(path, "Projects/Renamed"))).toBe(false);
    expect(events[0]).toBe("kickoff");
    expect(events).toContain("presentation:folderChanged:Projects/Renamed");
  });

  it("listFolderTree, listFolderItems, and moveItemToFolderPath exercise FS + index", async () => {
    const { ctx, meta, path } = await openVault();
    const { service, kickoff, onVaultPresentationChanged } = createService({
      ctx,
      meta,
      path,
    });

    await service.createFolder("Projects");
    await service.createFolder("Inbox");

    const timestamp = new Date().toISOString();
    const uuid = crypto.randomUUID();
    const itemId = `Projects/${uuid}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Movable",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Projects",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "body",
    });

    kickoff.mockClear();
    const tree = await service.listFolderTree();
    expect(kickoff).toHaveBeenCalledWith(meta.id, path);
    expect(tree.map((node) => node.path)).toEqual(
      expect.arrayContaining(["Inbox", "Projects"]),
    );

    kickoff.mockClear();
    const projectItems = await service.listFolderItems("Projects");
    expect(kickoff).toHaveBeenCalledWith(meta.id, path);
    expect(projectItems.map((item) => item.id)).toEqual([itemId]);

    kickoff.mockClear();
    onVaultPresentationChanged.mockClear();
    const moved = await service.moveItemToFolderPath(itemId, "Inbox");
    expect(moved.id).toBe(`Inbox/${uuid}.md`);
    expect(moved.folder_path).toBe("Inbox");
    expect(await fs.exists(joinSegments(path, `Inbox/${uuid}.md`))).toBe(true);
    expect(await fs.exists(joinSegments(path, itemId))).toBe(false);
    expect(
      (await readItemFile(fs, path, moved.id, meta.id)).folder_path,
    ).toBe("Inbox");
    expect(
      await ctx.index.listItemIdsByFolderPrefix(meta.id, "Inbox"),
    ).toEqual([moved.id]);
    expect(kickoff).toHaveBeenCalledWith(meta.id, path);
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId: meta.id,
      kind: "itemMoved",
      itemId: moved.id,
      fromFolderPath: "Projects",
      toFolderPath: "Inbox",
    });

    const inboxItems = await service.listFolderItems("Inbox");
    expect(inboxItems.map((item) => item.id)).toEqual([moved.id]);
  });

  it("listFolderItems forwards optional sort through the live index (#869)", async () => {
    const { ctx, meta, path } = await openVault();
    const { service } = createService({ ctx, meta, path });

    await service.createFolder("Shelf");
    const timestamp = new Date().toISOString();
    const shortId = `Shelf/${crypto.randomUUID()}.md`;
    const longId = `Shelf/${crypto.randomUUID()}.md`;
    const midId = `Shelf/${crypto.randomUUID()}.md`;
    const base = {
      vault_id: meta.id,
      description: "",
      content_type: "note" as const,
      source_type: "manual" as const,
      metadata: {},
      properties: {},
      tag_ids: [] as string[],
      collection_ids: [] as string[],
      folder_path: "Shelf",
      content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await upsertItem(ctx, path, meta.id, {
      item: { ...base, id: shortId, title: "Short" },
      content: "one two",
    });
    await upsertItem(ctx, path, meta.id, {
      item: { ...base, id: longId, title: "Long" },
      content: "a b c d e f g h i j",
    });
    await upsertItem(ctx, path, meta.id, {
      item: { ...base, id: midId, title: "Mid" },
      content: "alpha beta gamma delta",
    });

    const byWords = await service.listFolderItems("Shelf", {
      key: "word_count",
      dir: "desc",
    });
    expect(byWords.map((item) => item.id)).toEqual([longId, midId, shortId]);
    expect(byWords.map((item) => item.word_count)).toEqual([10, 4, 2]);
  });

  it("does not kick sync or emit when renameFolder fails before rewrite (#758)", async () => {
    const { ctx, meta, path } = await openVault();
    const { service, kickoff, onVaultPresentationChanged } = createService({
      ctx,
      meta,
      path,
    });

    await service.createFolder("A/B");
    kickoff.mockClear();
    onVaultPresentationChanged.mockClear();

    await expect(service.renameFolder("A", "A/B/A")).rejects.toThrow(
      /itself or a descendant/i,
    );

    expect(kickoff).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
    expect(await fs.exists(joinSegments(path, "A/B"))).toBe(true);
  });
});
