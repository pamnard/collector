/**
 * Worker-backed NodeSqliteExecutor (#749): proxy API + event-loop isolation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeSqliteExecutor } from "./node-sql.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "collector-node-sql-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

describe("NodeSqliteExecutor (worker-backed)", () => {
  it("open is async and execute/select round-trip", async () => {
    const openResult = NodeSqliteExecutor.open(tempDbPath());
    expect(openResult).toBeInstanceOf(Promise);
    const sql = await openResult;
    await sql.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    await sql.execute("INSERT INTO t (name) VALUES (?)", ["alpha"]);
    const rows = await sql.select<{ id: number; name: string }>(
      "SELECT id, name FROM t ORDER BY id",
    );
    expect(rows).toEqual([{ id: 1, name: "alpha" }]);
    await sql.close();
  });

  it("serializes concurrent requests without losing replies", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    await sql.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        sql.execute("INSERT INTO t (v) VALUES (?)", [i]),
      ),
    );
    const rows = await sql.select<{ n: number }>("SELECT COUNT(*) AS n FROM t");
    expect(rows[0]?.n).toBe(20);
    await sql.close();
  });

  it("close tears down the worker (no leaked thread)", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    const worker = sql.workerForTests;
    await sql.close();
    expect(worker.threadId).toBe(-1);
    await expect(sql.execute("SELECT 1")).rejects.toThrow(/closed/i);
  });

  it("does not block the main event loop during sustained writes", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    await sql.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, payload TEXT)");
    const payload = "x".repeat(64 * 1024);

    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);

    const writes = Promise.all(
      Array.from({ length: 200 }, () =>
        sql.execute("INSERT INTO t (payload) VALUES (?)", [payload]),
      ),
    );

    // Main-thread timers must keep firing while SQL runs in the worker.
    const deadline = Date.now() + 2000;
    while (ticks === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    const ticksWhileBusy = ticks;
    await writes;
    clearInterval(timer);

    expect(ticksWhileBusy).toBeGreaterThan(0);
    await sql.close();
  });

  it("propagates SQL errors from the worker", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    await expect(sql.execute("NOT VALID SQL")).rejects.toThrow();
    await sql.close();
  });

  it("preserves worker error name and stack on the proxy", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    let caught: unknown;
    try {
      await sql.execute("NOT VALID SQL");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.name.length).toBeGreaterThan(0);
    expect(error.name).not.toBe("Error");
    expect(error.stack).toMatch(/node-sql-worker|SqliteError|NOT VALID/i);
    await sql.close();
  });

  it("fails pending execute and close fast when worker terminates mid-flight", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    await sql.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, payload TEXT)");
    const payload = "x".repeat(256 * 1024);
    const inFlight = Promise.all(
      Array.from({ length: 40 }, () =>
        sql.execute("INSERT INTO t (payload) VALUES (?)", [payload]),
      ),
    );

    await sql.workerForTests.terminate();

    await expect(inFlight).rejects.toThrow(/exited unexpectedly|closed/i);

    const closeStarted = Date.now();
    await sql.close();
    expect(Date.now() - closeStarted).toBeLessThan(500);
    await expect(sql.execute("SELECT 1")).rejects.toThrow(
      /closed|exited unexpectedly/i,
    );
  });

  it("close() fails fast when worker terminates before close reply", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    const worker = sql.workerForTests;

    let resolveClosePosted!: () => void;
    const closePosted = new Promise<void>((resolve) => {
      resolveClosePosted = resolve;
    });
    const originalPost = worker.postMessage.bind(worker);
    worker.postMessage = ((value: unknown, transfer?: Transferable[]) => {
      originalPost(value, transfer);
      if (
        typeof value === "object" &&
        value !== null &&
        "op" in value &&
        (value as { op: string }).op === "close"
      ) {
        resolveClosePosted();
      }
    }) as typeof worker.postMessage;

    const closePromise = sql.close();
    await closePosted;
    // Drop reply path so only exit/#failAll can settle the in-flight close.
    worker.removeAllListeners("message");
    await worker.terminate();

    const started = Date.now();
    await expect(closePromise).rejects.toThrow(/exited unexpectedly|closed/i);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("does not throw from message listener after teardown for unknown pending id", async () => {
    const sql = await NodeSqliteExecutor.open(tempDbPath());
    const worker = sql.workerForTests;
    await sql.close();

    // EventEmitter.emit rethrows listener errors synchronously (not uncaughtException).
    expect(() => {
      worker.emit("message", { id: 999_999, ok: true, result: null });
    }).not.toThrow();
  });
});
