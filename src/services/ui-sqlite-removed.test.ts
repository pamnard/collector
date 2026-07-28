import { describe, expect, it, vi } from "vitest";

vi.mock("../dev/is-dev-mock", () => ({
  isDevMock: () => false,
}));

describe("UI in-process SQLite removed (#171 / #328)", () => {
  it("openCollectorDatabase refuses without composing index sync", async () => {
    const { openCollectorDatabase } = await import("./collector-service");
    await expect(openCollectorDatabase()).rejects.toThrow(/#171/);
  });

  it("non-mock listItems refuses early (#328 — no dual DomainRuntime)", async () => {
    const { listItems } = await import("./collector-service");
    await expect(listItems()).rejects.toThrow(/#171/);
  });

  it("sync status stays idle without vault sync orchestration", async () => {
    const { getVaultIndexSyncStatus } = await import("./collector-service");
    expect(getVaultIndexSyncStatus()).toMatchObject({
      vaultId: null,
      status: "idle",
      progress: null,
    });
  });
});
