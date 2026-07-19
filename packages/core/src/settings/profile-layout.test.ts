import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveCollectorProfileLayout,
  selfContainedCollectorProfileLayout,
} from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { migrateLegacyUnifiedProfileLayout } from "./profile-layout-migrate.js";

describe("collector profile layout (#238)", () => {
  it("maps production split roots like Tauri appConfig/appData", () => {
    const layout = resolveCollectorProfileLayout({
      dataDir: "/home/user/.local/share/com.collector.app/collector",
      configDir: "/home/user/.config/com.collector.app/collector",
    });
    expect(layout.indexDbPath).toBe(
      "/home/user/.config/com.collector.app/collector.db",
    );
  });

  it("maps self-contained --data-dir to config/ + collector.db under the same root", () => {
    const layout = selfContainedCollectorProfileLayout("/tmp/profile");
    expect(layout).toEqual({
      dataDir: "/tmp/profile",
      configDir: "/tmp/profile/config",
      indexDbPath: "/tmp/profile/collector.db",
    });
  });
});

describe("migrateLegacyUnifiedProfileLayout (#238)", () => {
  it("copies settings + index from dataDir into split config roots without touching vaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "collector-layout-migrate-"));
    const dataDir = join(root, "share", "collector");
    const configDir = join(root, "config", "collector");
    const vaultItem = join(dataDir, "vaults", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "note.md");
    mkdirSync(join(dataDir, "config"), { recursive: true });
    mkdirSync(join(vaultItem, ".."), { recursive: true });
    writeFileSync(join(dataDir, "config", "settings.json"), '{"theme":"dark"}');
    writeFileSync(join(dataDir, "collector.db"), "sqlite-bytes");
    writeFileSync(vaultItem, "# keep me\n");

    const layout = resolveCollectorProfileLayout({ dataDir, configDir });
    const fs = new NodeFileSystemAdapter();
    const result = await migrateLegacyUnifiedProfileLayout(fs, layout);

    expect(result).toEqual({ settingsMigrated: true, indexMigrated: true });
    expect(readFileSync(join(configDir, "settings.json"), "utf8")).toBe(
      '{"theme":"dark"}',
    );
    expect(readFileSync(layout.indexDbPath, "utf8")).toBe("sqlite-bytes");
    expect(readFileSync(vaultItem, "utf8")).toBe("# keep me\n");
    // Legacy sources remain (copy, not delete) so a partial cutover cannot orphan data.
    expect(existsSync(join(dataDir, "config", "settings.json"))).toBe(true);
  });

  it("does not overwrite existing destination settings/index", async () => {
    const root = mkdtempSync(join(tmpdir(), "collector-layout-keep-"));
    const dataDir = join(root, "share", "collector");
    const configDir = join(root, "config", "collector");
    mkdirSync(join(dataDir, "config"), { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(dataDir, "config", "settings.json"), '{"theme":"dark"}');
    writeFileSync(join(configDir, "settings.json"), '{"theme":"light"}');
    writeFileSync(join(dataDir, "collector.db"), "old-db");
    writeFileSync(join(root, "config", "collector.db"), "new-db");

    const layout = resolveCollectorProfileLayout({ dataDir, configDir });
    const fs = new NodeFileSystemAdapter();
    const result = await migrateLegacyUnifiedProfileLayout(fs, layout);

    expect(result).toEqual({ settingsMigrated: false, indexMigrated: false });
    expect(readFileSync(join(configDir, "settings.json"), "utf8")).toBe(
      '{"theme":"light"}',
    );
    expect(readFileSync(layout.indexDbPath, "utf8")).toBe("new-db");
  });

  it("is a no-op for self-contained layout", async () => {
    const root = mkdtempSync(join(tmpdir(), "collector-layout-self-"));
    const layout = selfContainedCollectorProfileLayout(root);
    mkdirSync(layout.configDir, { recursive: true });
    writeFileSync(join(layout.configDir, "settings.json"), "{}");
    writeFileSync(layout.indexDbPath, "db");
    const fs = new NodeFileSystemAdapter();
    const result = await migrateLegacyUnifiedProfileLayout(fs, layout);
    expect(result).toEqual({ settingsMigrated: false, indexMigrated: false });
  });
});
