/**
 * Vault layout guard runner — real inspect/remediate + vault FS (#886).
 * Mocking inspect/remediate would stay green if layout guard core broke.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isUuidMarkdownBasename,
  joinSegments,
  SqlVaultIndexStore,
  createVault,
  inspectVaultLayout,
  remediateVaultLayout,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createVaultLayoutGuardRunner } from "./vault-layout-guard-runner.js";

describe("createVaultLayoutGuardRunner (#886)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-layout-runner-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("remediates root markdown on disk and notifies onComplete", async () => {
    const { ctx, meta, path } = await seedVault();
    await fs.writeText(joinSegments(path, "a.md"), "---\ntitle: A\n---\n");
    expect((await inspectVaultLayout(fs, path)).ok).toBe(false);

    const completes: string[] = [];
    const runner = createVaultLayoutGuardRunner({
      getContext: () => ctx,
      onComplete: (vaultId) => {
        completes.push(vaultId);
      },
    });

    runner.schedule(meta.id, path);
    await vi.waitFor(async () => {
      expect(await fs.exists(joinSegments(path, "a.md"))).toBe(false);
      expect(completes).toEqual([meta.id]);
    });

    const inbox = await fs.readDir(joinSegments(path, INBOX_FOLDER_NAME));
    const moved = inbox.filter((n) => isUuidMarkdownBasename(n));
    expect(moved.length).toBeGreaterThanOrEqual(1);
    expect((await inspectVaultLayout(fs, path)).ok).toBe(true);
    expect((await inspectVaultLayout(fs, path)).rootMarkdown).toEqual([]);
    runner.dispose();
  });

  it("skips onComplete when layout already ok", async () => {
    const { ctx, meta, path } = await seedVault();
    expect((await inspectVaultLayout(fs, path)).ok).toBe(true);

    const completes: string[] = [];
    const runner = createVaultLayoutGuardRunner({
      getContext: () => ctx,
      onComplete: (vaultId) => {
        completes.push(vaultId);
      },
    });
    runner.schedule(meta.id, path);
    await new Promise((r) => setTimeout(r, 40));
    expect(completes).toEqual([]);
    expect((await inspectVaultLayout(fs, path)).ok).toBe(true);
    runner.dispose();
  });

  it("coalesces overlapping schedules into sequential real remediates", async () => {
    const { ctx, meta, path } = await seedVault();
    await fs.writeText(joinSegments(path, "a.md"), "---\ntitle: A\n---\n");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let remediateCount = 0;
    const completes: string[] = [];

    const runner = createVaultLayoutGuardRunner({
      getContext: () => ctx,
      // Real remediates — gate only to observe coalesce, not to fake layout work.
      remediate: async (fileSystem, vaultPath) => {
        const n = remediateCount;
        remediateCount += 1;
        const report = await remediateVaultLayout(fileSystem, vaultPath);
        if (n === 0) {
          await gate;
        }
        return report;
      },
      onComplete: (vaultId) => {
        completes.push(vaultId);
      },
    });

    runner.schedule(meta.id, path);
    await vi.waitFor(() => {
      expect(remediateCount).toBe(1);
    });
    expect(await fs.exists(joinSegments(path, "a.md"))).toBe(false);

    // Second mess while first run is gated — must not start a parallel remediate.
    await fs.writeText(joinSegments(path, "b.md"), "---\ntitle: B\n---\n");
    runner.schedule(meta.id, path);
    expect(remediateCount).toBe(1);

    release();
    await vi.waitFor(async () => {
      expect(remediateCount).toBe(2);
      expect(completes.length).toBe(2);
      expect(await fs.exists(joinSegments(path, "b.md"))).toBe(false);
    });

    const inbox = await fs.readDir(joinSegments(path, INBOX_FOLDER_NAME));
    const moved = inbox.filter((n) => isUuidMarkdownBasename(n));
    expect(moved.length).toBeGreaterThanOrEqual(2);
    expect((await inspectVaultLayout(fs, path)).ok).toBe(true);
    runner.dispose();
  });
});
