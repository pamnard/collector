import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppSettings = vi.fn();
const writeAppSettings = vi.fn();
const mergeAppSettings = vi.fn(
  (current: Record<string, unknown>, patch: Record<string, unknown>) => ({
    ...current,
    ...patch,
  }),
);
const createDefaultAppSettings = vi.fn(() => ({
  theme: "dark",
  active_vault_id: null,
}));

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    readAppSettings: (...args: unknown[]) => readAppSettings(...args),
    writeAppSettings: (...args: unknown[]) => writeAppSettings(...args),
    mergeAppSettings: (...args: unknown[]) =>
      mergeAppSettings(
        ...(args as [Record<string, unknown>, Record<string, unknown>]),
      ),
    createDefaultAppSettings: () => createDefaultAppSettings(),
  };
});

import { createAppSettingsService } from "./app-settings.js";

describe("createAppSettingsService", () => {
  const fs = {} as never;
  const ensureConfigDir = vi.fn(async () => "/config");
  const readLegacySettings = vi.fn(() => ({ theme: "light" as const }));
  const readDevMockSettings = vi.fn(() => null);
  const writeDevMockSettings = vi.fn();

  beforeEach(() => {
    readAppSettings.mockReset();
    writeAppSettings.mockReset();
    mergeAppSettings.mockClear();
    createDefaultAppSettings.mockClear();
    ensureConfigDir.mockClear();
    readLegacySettings.mockClear();
    readDevMockSettings.mockReset();
    writeDevMockSettings.mockReset();
  });

  function createService(isDevMock = false) {
    return createAppSettingsService({
      fs,
      ensureConfigDir,
      isDevMock: () => isDevMock,
      readLegacySettings,
      readDevMockSettings,
      writeDevMockSettings,
    });
  }

  it("loads stored settings from disk", async () => {
    readAppSettings.mockResolvedValue({ theme: "dark", active_vault_id: "v1" });
    const service = createService();
    const settings = await service.ensureAppSettings();
    expect(settings).toEqual({ theme: "dark", active_vault_id: "v1" });
    expect(service.getAppSettingsSync()).toEqual(settings);
  });

  it("notifies subscribers immediately on update", async () => {
    readAppSettings.mockResolvedValue({ theme: "dark", active_vault_id: null });
    const service = createService();
    const seen: unknown[] = [];
    service.subscribeAppSettings((s) => seen.push(s.active_vault_id));

    await service.updateAppSettings({ active_vault_id: "v2" });

    expect(seen).toEqual(["v2"]);
    expect(writeAppSettings).toHaveBeenCalled();
  });

  it("uses legacy + default when nothing on disk", async () => {
    readAppSettings.mockResolvedValue(null);
    const service = createService();
    await service.ensureAppSettings();
    expect(createDefaultAppSettings).toHaveBeenCalled();
    expect(readLegacySettings).toHaveBeenCalled();
    expect(writeAppSettings).toHaveBeenCalled();
  });
});
