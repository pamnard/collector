import { beforeEach, describe, expect, it, vi } from "vitest";

const readDashboardSnapshot = vi.fn();
const writeDashboardSnapshot = vi.fn();
const clearDashboardSnapshotFile = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    readDashboardSnapshot: (...args: unknown[]) =>
      readDashboardSnapshot(...args),
    writeDashboardSnapshot: (...args: unknown[]) =>
      writeDashboardSnapshot(...args),
    clearDashboardSnapshot: (...args: unknown[]) =>
      clearDashboardSnapshotFile(...args),
  };
});

import { createDashboardSnapshotService } from "./dashboard-snapshot.js";

describe("createDashboardSnapshotService", () => {
  const fs = {} as never;
  const ensureConfigDir = vi.fn(async () => "/config");
  const readDevMockSnapshot = vi.fn(() => null);
  const writeDevMockSnapshot = vi.fn();
  const onSnapshotLoaded = vi.fn();

  beforeEach(() => {
    readDashboardSnapshot.mockReset();
    writeDashboardSnapshot.mockReset();
    clearDashboardSnapshotFile.mockReset();
    ensureConfigDir.mockClear();
    readDevMockSnapshot.mockReset();
    writeDevMockSnapshot.mockReset();
    onSnapshotLoaded.mockReset();
  });

  function createService() {
    return createDashboardSnapshotService({
      fs,
      ensureConfigDir,
      isDevMock: () => false,
      readDevMockSnapshot,
      writeDevMockSnapshot,
      onSnapshotLoaded,
    });
  }

  it("loads snapshot and seeds query cache once", async () => {
    const snapshot = {
      schema_version: 1,
      vault_id: "v1",
      nav_filter: "all",
      search: "",
      item_ids: ["a.md"],
      items: [],
      total_count: 1,
      stream_end_offset: 0,
      saved_at: "t",
    };
    readDashboardSnapshot.mockResolvedValue(snapshot);

    const service = createService();
    expect(await service.ensureDashboardSnapshot()).toEqual(snapshot);
    expect(await service.ensureDashboardSnapshot()).toEqual(snapshot);
    expect(readDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshotLoaded).toHaveBeenCalledWith(snapshot);
  });

  it("peekMatchingDashboardSnapshot requires matching vault/filter/search", async () => {
    const snapshot = {
      schema_version: 1,
      vault_id: "v1",
      nav_filter: "all",
      search: "x",
      item_ids: [],
      items: [],
      total_count: 0,
      stream_end_offset: 0,
      saved_at: "t",
    };
    readDashboardSnapshot.mockResolvedValue(snapshot);
    const service = createService();
    await service.ensureDashboardSnapshot();

    expect(
      service.peekMatchingDashboardSnapshot({
        vaultId: "v1",
        filter: "all",
        search: "x",
      }),
    ).toEqual(snapshot);
    expect(
      service.peekMatchingDashboardSnapshot({
        vaultId: "v1",
        filter: "all",
        search: "other",
      }),
    ).toBeNull();
  });

  it("clearDashboardSnapshot clears cache and disk", async () => {
    const service = createService();
    await service.clearDashboardSnapshot();
    expect(clearDashboardSnapshotFile).toHaveBeenCalled();
    expect(await service.ensureDashboardSnapshot()).toBeNull();
    expect(readDashboardSnapshot).not.toHaveBeenCalled();
  });
});
