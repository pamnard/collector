import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dashboardSnapshotMatchesQuery,
  type DashboardSnapshot,
} from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  clearDashboardSnapshot,
  readDashboardSnapshot,
  writeDashboardSnapshot,
} from "./dashboard-snapshot-io.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "Inbox/welcome-note.md";
const NOW = "2026-01-01T00:00:00.000Z";

function syntheticSnapshot(
  overrides: Partial<DashboardSnapshot> = {},
): DashboardSnapshot {
  return {
    schema_version: 1,
    vault_id: VAULT_ID,
    nav_filter: "all",
    search: "",
    item_ids: [ITEM_ID],
    items: [
      {
        id: ITEM_ID,
        vault_id: VAULT_ID,
        title: "Synthetic warm-start item",
        description: "",
        content_type: "bookmark",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Inbox",
        content_revision: 1,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    total_count: 1,
    stream_end_offset: 1,
    saved_at: NOW,
    ...overrides,
  };
}

describe("dashboard-snapshot-io", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempConfigDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "collector-snapshot-"));
    dirs.push(dir);
    return dir;
  }

  it("round-trips snapshot read/write", async () => {
    const fs = new NodeFileSystemAdapter();
    const configDir = await tempConfigDir();
    const snapshot = syntheticSnapshot();

    await writeDashboardSnapshot(fs, configDir, snapshot);
    const loaded = await readDashboardSnapshot(fs, configDir);

    expect(loaded).toEqual(snapshot);
  });

  it("clearDashboardSnapshot removes persisted file", async () => {
    const fs = new NodeFileSystemAdapter();
    const configDir = await tempConfigDir();
    await writeDashboardSnapshot(fs, configDir, syntheticSnapshot());

    await clearDashboardSnapshot(fs, configDir);

    expect(await readDashboardSnapshot(fs, configDir)).toBeNull();
  });

  it("dashboardSnapshotMatchesQuery compares vault, filter, and search", () => {
    const snapshot = syntheticSnapshot({
      nav_filter: { type: "tag", tag_id: "33333333-3333-4333-8333-333333333333" },
      search: "notes",
    });

    expect(
      dashboardSnapshotMatchesQuery(snapshot, {
        vaultId: VAULT_ID,
        navFilter: { type: "tag", tag_id: "33333333-3333-4333-8333-333333333333" },
        search: "notes",
      }),
    ).toBe(true);

    expect(
      dashboardSnapshotMatchesQuery(snapshot, {
        vaultId: VAULT_ID,
        navFilter: "all",
        search: "notes",
      }),
    ).toBe(false);

    expect(
      dashboardSnapshotMatchesQuery(snapshot, {
        vaultId: VAULT_ID,
        navFilter: { type: "tag", tag_id: "33333333-3333-4333-8333-333333333333" },
        search: "other",
      }),
    ).toBe(false);
  });

  it("round-trips snapshot with root-level path id (<uuid>.md)", async () => {
    const fs = new NodeFileSystemAdapter();
    const configDir = await tempConfigDir();
    const pathId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md";
    const snapshot = syntheticSnapshot({
      item_ids: [pathId],
      items: [
        {
          id: pathId,
          vault_id: VAULT_ID,
          title: "Welcome",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    });

    await writeDashboardSnapshot(fs, configDir, snapshot);
    expect(await readDashboardSnapshot(fs, configDir)).toEqual(snapshot);
  });
});
