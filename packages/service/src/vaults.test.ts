import { beforeEach, describe, expect, it, vi } from "vitest";

const readVaultMeta = vi.fn();
const writeVaultMeta = vi.fn();
const assertVaultTreeLayout = vi.fn();
const createVault = vi.fn();
const upsertItem = vi.fn();
const runEmptyVaultBootstrap = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    readVaultMeta: (...args: unknown[]) => readVaultMeta(...args),
    writeVaultMeta: (...args: unknown[]) => writeVaultMeta(...args),
    assertVaultTreeLayout: (...args: unknown[]) =>
      assertVaultTreeLayout(...args),
    createVault: (...args: unknown[]) => createVault(...args),
    upsertItem: (...args: unknown[]) => upsertItem(...args),
    runEmptyVaultBootstrap: (...args: unknown[]) =>
      runEmptyVaultBootstrap(...args),
  };
});

import { createVaultsService } from "./vaults.js";

describe("createVaultsService", () => {
  const vault = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Vault",
    is_default: true,
    created_at: "a",
    updated_at: "a",
  };
  const exists = vi.fn();
  const readDir = vi.fn();
  const mkdir = vi.fn();
  const upsertVault = vi.fn();
  const fs = { exists, readDir, mkdir };
  const ctx = { fs, index: { upsertVault } } as never;
  const ensureAppSettings = vi.fn(async () => ({ active_vault_id: vault.id }));
  const updateAppSettings = vi.fn(async (patch: { active_vault_id: string }) => ({
    active_vault_id: patch.active_vault_id,
  }));
  const clearDashboardSnapshot = vi.fn(async () => {});
  const stopVaultFilesystemWatcher = vi.fn(async () => {});
  const enableVaultWatcher = vi.fn();

  beforeEach(() => {
    readVaultMeta.mockReset();
    writeVaultMeta.mockReset();
    assertVaultTreeLayout.mockReset();
    createVault.mockReset();
    upsertItem.mockReset();
    runEmptyVaultBootstrap.mockReset();
    exists.mockReset();
    readDir.mockReset();
    mkdir.mockReset();
    upsertVault.mockReset();
    ensureAppSettings.mockClear();
    updateAppSettings.mockReset();
    clearDashboardSnapshot.mockReset();
    stopVaultFilesystemWatcher.mockReset();
    enableVaultWatcher.mockReset();
  });

  function createService() {
    return createVaultsService({
      ensureInitialized: async () => {},
      getDataDir: () => "/data",
      getContext: () => ctx,
      ensureAppSettings: ensureAppSettings as never,
      updateAppSettings: updateAppSettings as never,
      clearDashboardSnapshot,
      stopVaultFilesystemWatcher,
      enableVaultWatcher,
    });
  }

  it("listVaults reads UUID vault dirs with meta", async () => {
    exists.mockImplementation(async (path: string) => {
      if (path.endsWith("vaults")) return true;
      if (path.includes("vault.json") || path.includes("meta")) return true;
      return true;
    });
    readDir.mockResolvedValue([vault.id, "not-a-uuid", "backup"]);
    readVaultMeta.mockResolvedValue(vault);

    const result = await createService().listVaults();
    expect(result).toEqual([vault]);
    expect(readVaultMeta).toHaveBeenCalled();
  });

  it("switchVault updates active settings and clears snapshot", async () => {
    exists.mockResolvedValue(true);
    readDir.mockResolvedValue([vault.id]);
    readVaultMeta.mockResolvedValue(vault);
    assertVaultTreeLayout.mockResolvedValue(undefined);

    const meta = await createService().switchVault(vault.id);

    expect(meta).toEqual(vault);
    expect(enableVaultWatcher).toHaveBeenCalledWith(vault.id);
    expect(stopVaultFilesystemWatcher).toHaveBeenCalled();
    expect(clearDashboardSnapshot).toHaveBeenCalled();
    expect(updateAppSettings).toHaveBeenCalledWith({
      active_vault_id: vault.id,
    });
  });

  it("switchVault rejects unknown vault", async () => {
    exists.mockResolvedValue(true);
    readDir.mockResolvedValue([]);
    await expect(createService().switchVault("missing")).rejects.toThrow(
      /Vault not found/,
    );
  });
});
