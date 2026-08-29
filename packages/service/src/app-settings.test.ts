import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppSettings,
  readAppSettings,
  writeAppSettings,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { AppSettings } from "@collector/shared";
import { createAppSettingsService } from "./app-settings.js";

const VAULT_A = "11111111-2222-3333-4444-555555555555";
const VAULT_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("createAppSettingsService", () => {
  let profileDir = "";
  let configDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (profileDir) {
      await rm(profileDir, { recursive: true, force: true });
      profileDir = "";
      configDir = "";
    }
  });

  async function openTempProfile(): Promise<void> {
    profileDir = await mkdtemp(join(tmpdir(), "collector-app-settings-"));
    configDir = join(profileDir, "config");
    await fs.mkdir(configDir);
  }

  function createService(overrides?: {
    isDevMock?: boolean;
    readLegacySettings?: () => Partial<AppSettings>;
    ensureConfigDir?: () => Promise<string>;
  }) {
    return createAppSettingsService({
      fs,
      ensureConfigDir:
        overrides?.ensureConfigDir ?? (async () => configDir),
      isDevMock: () => overrides?.isDevMock === true,
      readLegacySettings: overrides?.readLegacySettings ?? (() => ({})),
      readDevMockSettings: () => null,
      writeDevMockSettings: () => {
        throw new Error("writeDevMockSettings must not run outside DevMock");
      },
    });
  }

  it("loads stored settings from disk", async () => {
    await openTempProfile();
    const stored = {
      ...createDefaultAppSettings(),
      theme: "dark" as const,
      active_vault_id: VAULT_A,
    };
    await writeAppSettings(fs, configDir, stored);

    const service = createService();
    const settings = await service.ensureAppSettings();

    expect(settings).toEqual(stored);
    expect(service.getAppSettingsSync()).toEqual(stored);
    expect(await readAppSettings(fs, configDir)).toEqual(stored);
  });

  it("notifies subscribers immediately on update and persists values", async () => {
    await openTempProfile();
    await writeAppSettings(fs, configDir, {
      ...createDefaultAppSettings(),
      theme: "dark",
      active_vault_id: null,
    });

    const service = createService();
    const seen: Array<string | null | undefined> = [];
    service.subscribeAppSettings((s) => seen.push(s.active_vault_id));

    const updated = await service.updateAppSettings({
      active_vault_id: VAULT_B,
    });

    expect(seen).toEqual([VAULT_B]);
    expect(updated.active_vault_id).toBe(VAULT_B);
    expect(service.getAppSettingsSync()?.active_vault_id).toBe(VAULT_B);

    const onDisk = await readAppSettings(fs, configDir);
    expect(onDisk?.active_vault_id).toBe(VAULT_B);
    expect(onDisk?.theme).toBe("dark");
  });

  it("writes merged legacy + default settings when nothing on disk", async () => {
    await openTempProfile();

    const service = createService({
      readLegacySettings: () => ({ theme: "light" }),
    });
    const settings = await service.ensureAppSettings();

    const expected = {
      ...createDefaultAppSettings(),
      theme: "light" as const,
    };
    expect(settings).toEqual(expected);
    expect(await readAppSettings(fs, configDir)).toEqual(expected);
  });

  it("getAppConfigDirectory skips ensureConfigDir on DevMock", async () => {
    const ensureConfigDir = vi.fn(async () => configDir);
    const service = createService({
      isDevMock: true,
      ensureConfigDir,
    });

    await expect(service.getAppConfigDirectory()).resolves.toBe(
      "/dev-mock/config",
    );
    expect(ensureConfigDir).not.toHaveBeenCalled();
  });
});
