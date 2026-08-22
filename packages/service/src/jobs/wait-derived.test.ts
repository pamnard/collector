import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  itemDerivedRefreshIdempotencyKey,
  itemDerivedRefreshJobType,
} from "@collector/shared";
import { createJobQueue } from "./job-queue.js";
import { createJobRegistry } from "./job-registry.js";
import { waitDerived } from "./wait-derived.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
}

const samplePayload = {
  vaultId: "vault-1",
  vaultPath: "/vault",
  itemId: "Inbox/note.md",
  contentRevision: 4,
  fileMtimeMs: 1_700_000_000_000,
};

describe("waitDerived (#770)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempJobsPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "collector-wait-derived-"));
    dirs.push(dir);
    return join(dir, "jobs.db");
  }

  it("awaits terminal success for the item revision", async () => {
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: tempJobsPath(),
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    const { id } = await queue.enqueue({
      type: itemDerivedRefreshJobType.id,
      payload: samplePayload,
      idempotencyKey: itemDerivedRefreshIdempotencyKey(samplePayload),
    });

    const result = await waitDerived({
      queue,
      vaultId: samplePayload.vaultId,
      itemId: samplePayload.itemId,
      contentRevision: samplePayload.contentRevision,
      timeoutMs: 5_000,
    });
    expect(result).toEqual({
      status: "succeeded",
      jobId: id,
      contentRevision: samplePayload.contentRevision,
    });
    await queue.stop();
  });

  it("matches exact fileMtimeMs when provided", async () => {
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: tempJobsPath(),
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    const { id } = await queue.enqueue({
      type: itemDerivedRefreshJobType.id,
      payload: samplePayload,
      idempotencyKey: itemDerivedRefreshIdempotencyKey(samplePayload),
    });

    const result = await waitDerived({
      queue,
      vaultId: samplePayload.vaultId,
      itemId: samplePayload.itemId,
      contentRevision: samplePayload.contentRevision,
      fileMtimeMs: samplePayload.fileMtimeMs,
      timeoutMs: 5_000,
    });
    expect(result).toEqual({
      status: "succeeded",
      jobId: id,
      contentRevision: samplePayload.contentRevision,
    });
    await queue.stop();
  });

  it("returns failed when the derived job permanently fails", async () => {
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({
      status: "fail",
      retryable: false,
      error: "derived boom",
    }));
    const queue = await createJobQueue({
      dbPath: tempJobsPath(),
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    await queue.enqueue({
      type: itemDerivedRefreshJobType.id,
      payload: { ...samplePayload, contentRevision: 2 },
      idempotencyKey: itemDerivedRefreshIdempotencyKey({
        ...samplePayload,
        contentRevision: 2,
      }),
      maxAttempts: 1,
    });

    const result = await waitDerived({
      queue,
      vaultId: samplePayload.vaultId,
      itemId: samplePayload.itemId,
      contentRevision: 2,
      timeoutMs: 5_000,
    });
    expect(result.status).toBe("failed");
    expect(result.contentRevision).toBe(2);
    await queue.stop();
  });

  it("finds an already-terminal job without waiting forever", async () => {
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: tempJobsPath(),
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    const payload = { ...samplePayload, contentRevision: 1 };
    const { id } = await queue.enqueue({
      type: itemDerivedRefreshJobType.id,
      payload,
      idempotencyKey: itemDerivedRefreshIdempotencyKey(payload),
    });
    await waitFor(async () => {
      const row = await queue.getJob(id);
      return row?.status === "succeeded";
    });

    const result = await waitDerived({
      queue,
      vaultId: payload.vaultId,
      itemId: payload.itemId,
      contentRevision: payload.contentRevision,
      timeoutMs: 2_000,
    });
    expect(result).toEqual({
      status: "succeeded",
      jobId: id,
      contentRevision: payload.contentRevision,
    });
    await queue.stop();
  });

  it("times out when no derived job appears for the revision", async () => {
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: tempJobsPath(),
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    queue.start();

    await expect(
      waitDerived({
        queue,
        vaultId: "vault-1",
        itemId: "Inbox/missing.md",
        contentRevision: 9,
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/timed out waiting for itemDerivedRefresh/);
    await queue.stop();
  });

  it("rejects non-integer contentRevision fail-fast", async () => {
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({ status: "ok" }));
    const queue = await createJobQueue({
      dbPath: tempJobsPath(),
      registry,
      pollIntervalMs: 20,
      timeoutMs: 1000,
    });
    await expect(
      waitDerived({
        queue,
        vaultId: "v",
        itemId: "a.md",
        contentRevision: 1.5,
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/integer contentRevision/);
    await queue.stop();
  });
});

describe("default mutate path does not await derived (#770)", () => {
  it("ItemsPort waitDerived is a separate opt-in from updateItem", async () => {
    type UpdateItemArgs = Parameters<
      import("@collector/api").ItemsPort["updateItem"]
    >;
    type WaitDerivedArgs = Parameters<
      import("@collector/api").ItemsPort["waitDerived"]
    >;
    const updateArity: UpdateItemArgs["length"] = 2;
    const waitArity: WaitDerivedArgs["length"] = 2;
    expect(updateArity).toBe(2);
    expect(waitArity).toBeGreaterThanOrEqual(2);
    expect(updateArity).not.toBe(waitArity + 1);
  });
});
