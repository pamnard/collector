import { describe, expect, it, vi } from "vitest";
import type { VaultContext } from "@collector/core";
import { createVaultLayoutGuardRunner } from "./vault-layout-guard-runner.js";

describe("createVaultLayoutGuardRunner", () => {
  it("coalesces overlapping schedules into sequential runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inspectCount = 0;
    const remediateCalls: number[] = [];
    const completes: string[] = [];

    const runner = createVaultLayoutGuardRunner({
      getContext: () => ({ fs: {} } as VaultContext),
      inspect: async () => {
        inspectCount += 1;
        return {
          ok: false,
          rootMarkdown: ["a.md"],
          rootLooseFiles: [],
          looseFilesInCollections: [],
          nonUuidMarkdown: [],
        };
      },
      remediate: async () => {
        const n = remediateCalls.length;
        remediateCalls.push(n);
        if (n === 0) {
          await gate;
        }
        return { renamed: 0, movedRootNotes: 1, importedLoose: 0 };
      },
      onComplete: (vaultId) => {
        completes.push(vaultId);
      },
    });

    runner.schedule("v1", "/vault");
    await vi.waitFor(() => {
      expect(remediateCalls.length).toBe(1);
    });
    runner.schedule("v1", "/vault");
    expect(remediateCalls.length).toBe(1);

    release();
    await vi.waitFor(() => {
      expect(remediateCalls.length).toBe(2);
      expect(completes.length).toBe(2);
    });
    expect(inspectCount).toBe(2);
    runner.dispose();
  });

  it("skips onComplete when layout already ok", async () => {
    const completes: string[] = [];
    const runner = createVaultLayoutGuardRunner({
      getContext: () => ({ fs: {} } as VaultContext),
      inspect: async () => ({
        ok: true,
        rootMarkdown: [],
        rootLooseFiles: [],
        looseFilesInCollections: [],
        nonUuidMarkdown: [],
      }),
      remediate: async () => {
        throw new Error("should not remediate");
      },
      onComplete: (vaultId) => {
        completes.push(vaultId);
      },
    });
    runner.schedule("v1", "/vault");
    await new Promise((r) => setTimeout(r, 20));
    expect(completes).toEqual([]);
    runner.dispose();
  });
});
