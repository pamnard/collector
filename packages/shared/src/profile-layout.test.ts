import { describe, expect, it } from "vitest";
import {
  indexDbPathForConfigDir,
  resolveCollectorProfileLayout,
  selfContainedCollectorProfileLayout,
} from "./profile-layout.js";

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
    expect(indexDbPathForConfigDir(layout.configDir)).toBe(layout.indexDbPath);
  });

  it("rejects empty roots", () => {
    expect(() =>
      resolveCollectorProfileLayout({ dataDir: "", configDir: "/x" }),
    ).toThrow(/dataDir/);
    expect(() =>
      resolveCollectorProfileLayout({ dataDir: "/x", configDir: "" }),
    ).toThrow(/configDir/);
  });
});
