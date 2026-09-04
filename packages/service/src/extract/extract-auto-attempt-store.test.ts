import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  EXTRACT_AUTO_STATE_DIR,
  createExtractAutoAttemptStore,
} from "./extract-auto-attempt-store.js";

describe("createExtractAutoAttemptStore", () => {
  const dirs: string[] = [];
  const fs = new NodeFileSystemAdapter();

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openStore() {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-extract-auto-store-"));
    dirs.push(dataDir);
    return {
      dataDir,
      store: createExtractAutoAttemptStore({ fs, dataDir }),
    };
  }

  it("returns empty map when no state file exists", async () => {
    const { store } = openStore();
    expect(await store.readItemAttempts("vault-1", "Inbox/a.md")).toEqual({});
  });

  it("persists attempts under dataDir/extract-auto/{vaultId}.json", async () => {
    const { dataDir, store } = openStore();
    const itemId = "Inbox/note.md";

    await store.recordAttempt("vault-1", itemId, "AbC", {
      attempted_at: "2026-01-01T00:00:00.000Z",
      ok: true,
    });
    await store.recordAttempt("vault-1", itemId, "XyZ", {
      attempted_at: "2026-01-02T00:00:00.000Z",
      ok: false,
      error: "boom",
    });

    expect(await store.readItemAttempts("vault-1", itemId)).toEqual({
      AbC: { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
      XyZ: {
        attempted_at: "2026-01-02T00:00:00.000Z",
        ok: false,
        error: "boom",
      },
    });
    expect(await store.readItemAttempts("vault-1", "other.md")).toEqual({});

    const path = join(dataDir, EXTRACT_AUTO_STATE_DIR, "vault-1.json");
    expect(await fs.exists(path)).toBe(true);
    const disk = JSON.parse(await fs.readText(path)) as {
      schema_version: number;
      items: Record<string, unknown>;
    };
    expect(disk.schema_version).toBe(1);
    expect(disk.items[itemId]).toMatchObject({
      AbC: { ok: true },
      XyZ: { ok: false, error: "boom" },
    });
  });

  it("isolates attempts by vaultId", async () => {
    const { store } = openStore();
    await store.recordAttempt("v-a", "n.md", "sc", {
      attempted_at: "2026-01-01T00:00:00.000Z",
      ok: true,
    });
    expect(await store.readItemAttempts("v-b", "n.md")).toEqual({});
  });
});
