import { describe, expect, it, vi } from "vitest";

vi.mock("../dev/is-dev-mock", () => ({
  isDevMock: () => false,
}));

vi.mock("./profile-layout", () => ({
  getCollectorProfileLayout: async () => ({
    dataDir: "/tmp/collector-data",
    configDir: "/tmp/collector-config",
    indexDbPath: "/tmp/collector.db",
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/tmp",
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("../adapters/tauri-fs", () => ({
  TauriFileSystemAdapter: class {
    async mkdir(): Promise<void> {}
    async exists(): Promise<boolean> {
      return false;
    }
    async remove(): Promise<void> {}
  },
}));

describe("UI in-process SQLite removed (#171)", () => {
  it("openCollectorDatabase refuses to open SQLite in the UI", async () => {
    const { openCollectorDatabase } = await import("./collector-service");
    await expect(openCollectorDatabase()).rejects.toThrow(/#171/);
  });
});
