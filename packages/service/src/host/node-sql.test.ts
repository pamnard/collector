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
});
