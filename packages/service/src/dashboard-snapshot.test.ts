/**
 * createDashboardSnapshotService against real core snapshot IO on a temp config dir.
 * No core/DevMock mocks — assert fields written to dashboard-snapshot.json on disk.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  DASHBOARD_SNAPSHOT_FILE,
  DASHBOARD_SNAPSHOT_VERSION,
  type DashboardSnapshot,
} from "@collector/shared";
import { createDashboardSnapshotService } from "./dashboard-snapshot.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "Inbox/welcome-note.md";
const NOW = "2026-01-01T00:00:00.000Z";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collector-svc-dash-snap-"));
  dirs.push(dir);
  return dir;
}

function snapshotOnDiskPath(configDir: string): string {
  return join(configDir, DASHBOARD_SNAPSHOT_FILE);
}

async function readSnapshotJsonFromDisk(
  configDir: string,
): Promise<DashboardSnapshot> {
  const raw = await readFile(snapshotOnDiskPath(configDir), "utf8");
  return JSON.parse(raw) as DashboardSnapshot;
}

function createService(configDir: string, onSnapshotLoaded?: (s: DashboardSnapshot) => void) {
  const fs = new NodeFileSystemAdapter();
  return createDashboardSnapshotService({
    fs,
    ensureConfigDir: async () => configDir,
    isDevMock: () => false,
    readDevMockSnapshot: () => {
      throw new Error("DevMock snapshot read must not run");
    },
    writeDevMockSnapshot: () => {
      throw new Error("DevMock snapshot write must not run");
    },
    onSnapshotLoaded,
  });
}

describe("createDashboardSnapshotService", () => {
  it("persist writes snapshot fields to disk JSON", async () => {
    const configDir = await tempConfigDir();
    const service = createService(configDir);
    const snapshot = service.buildDashboardSnapshot({
      vaultId: VAULT_ID,
      filter: "all",
      search: "",
      itemIds: [ITEM_ID],
      items: [
        {
          id: ITEM_ID,
          vault_id: VAULT_ID,
          title: "Service snapshot IO item",
          description: "",
          content_type: "bookmark",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "Inbox",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      totalCount: 1,
      streamEndOffset: 1,
      bodyStamps: { [ITEM_ID]: "1000" },
      coverPaths: {
        [ITEM_ID]: { path: "/tmp/cover.webp", stamp: `:${NOW}` },
      },
    });

    await service.persistDashboardSnapshot(snapshot);

    const onDisk = await readSnapshotJsonFromDisk(configDir);
    expect(onDisk.schema_version).toBe(DASHBOARD_SNAPSHOT_VERSION);
    expect(onDisk.vault_id).toBe(VAULT_ID);
    expect(onDisk.nav_filter).toBe("all");
    expect(onDisk.search).toBe("");
    expect(onDisk.sort_key).toBe("created_at");
    expect(onDisk.sort_dir).toBe("desc");
    expect(onDisk.item_ids).toEqual([ITEM_ID]);
    expect(onDisk.items).toHaveLength(1);
    expect(onDisk.items[0]?.id).toBe(ITEM_ID);
    expect(onDisk.items[0]?.title).toBe("Service snapshot IO item");
    expect(onDisk.body_stamps).toEqual({ [ITEM_ID]: "1000" });
    expect(onDisk.total_count).toBe(1);
    expect(onDisk.stream_end_offset).toBe(1);
    expect(onDisk.cover_paths).toEqual({
      [ITEM_ID]: { path: "/tmp/cover.webp", stamp: `:${NOW}` },
    });
    expect(onDisk.saved_at).toBe(snapshot.saved_at);
  });

  it("ensure loads snapshot from disk once and seeds query cache", async () => {
    const configDir = await tempConfigDir();
    const writer = createService(configDir);
    const snapshot = writer.buildDashboardSnapshot({
      vaultId: VAULT_ID,
      filter: "all",
      search: "notes",
      itemIds: [ITEM_ID],
      items: [],
      totalCount: 1,
      streamEndOffset: 0,
    });
    await writer.persistDashboardSnapshot(snapshot);

    const loaded: DashboardSnapshot[] = [];
    const reader = createService(configDir, (s) => {
      loaded.push(s);
    });

    expect(await reader.ensureDashboardSnapshot()).toEqual(
      await readSnapshotJsonFromDisk(configDir),
    );
    expect(await reader.ensureDashboardSnapshot()).toEqual(
      await readSnapshotJsonFromDisk(configDir),
    );
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.vault_id).toBe(VAULT_ID);
    expect(loaded[0]?.search).toBe("notes");
    expect(loaded[0]?.item_ids).toEqual([ITEM_ID]);
  });

  it("peekMatchingDashboardSnapshot requires matching vault/filter/search/sort", async () => {
    const configDir = await tempConfigDir();
    const service = createService(configDir);
    const snapshot = service.buildDashboardSnapshot({
      vaultId: VAULT_ID,
      filter: "all",
      search: "x",
      sort: { key: "created_at", dir: "desc" },
      itemIds: [],
      items: [],
      totalCount: 0,
      streamEndOffset: 0,
    });
    await service.persistDashboardSnapshot(snapshot);
    await service.ensureDashboardSnapshot();

    expect(
      service.peekMatchingDashboardSnapshot({
        vaultId: VAULT_ID,
        filter: "all",
        search: "x",
      }),
    ).toEqual(snapshot);
    expect(
      service.peekMatchingDashboardSnapshot({
        vaultId: VAULT_ID,
        filter: "all",
        search: "other",
      }),
    ).toBeNull();
    expect(
      service.peekMatchingDashboardSnapshot({
        vaultId: VAULT_ID,
        filter: "all",
        search: "x",
        sort: { key: "title", dir: "asc" },
      }),
    ).toBeNull();
  });

  it("clearDashboardSnapshot removes disk file and keeps cache empty", async () => {
    const configDir = await tempConfigDir();
    const service = createService(configDir);
    const snapshot = service.buildDashboardSnapshot({
      vaultId: VAULT_ID,
      filter: "all",
      search: "",
      itemIds: [],
      items: [],
      totalCount: 0,
      streamEndOffset: 0,
    });
    await service.persistDashboardSnapshot(snapshot);
    expect(await readSnapshotJsonFromDisk(configDir)).toMatchObject({
      vault_id: VAULT_ID,
    });

    await service.clearDashboardSnapshot();

    await expect(readFile(snapshotOnDiskPath(configDir), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await service.ensureDashboardSnapshot()).toBeNull();

    const fresh = createService(configDir);
    expect(await fresh.ensureDashboardSnapshot()).toBeNull();
  });
});
