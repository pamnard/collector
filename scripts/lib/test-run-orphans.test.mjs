/**
 * Unit tests for test-run orphan detection (node:test).
 * Spawns short-lived children with COLLECTOR_TEST_RUN_ID and asserts detection.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  TEST_RUN_ID_ENV,
  collectAncestorPids,
  listProcessesWithTestRunId,
} from "./test-run-orphans.mjs";

function spawnSleepWithRunId(runId, seconds = 30) {
  return spawn("sleep", [String(seconds)], {
    env: { ...process.env, [TEST_RUN_ID_ENV]: runId },
    stdio: "ignore",
  });
}

describe("listProcessesWithTestRunId", () => {
  const live = [];

  after(() => {
    for (const child of live) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  });

  it("finds a live child that inherited the test run id", async () => {
    const runId = randomUUID();
    const child = spawnSleepWithRunId(runId);
    live.push(child);
    assert.ok(child.pid);

    // Brief settle so /proc/<pid>/environ is readable.
    await new Promise((r) => setTimeout(r, 50));

    const hits = listProcessesWithTestRunId(runId);
    const match = hits.find((h) => h.pid === child.pid);
    assert.ok(match, `expected pid ${child.pid} in ${JSON.stringify(hits)}`);
    assert.match(match.cmdline, /sleep/);

    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
  });

  it("ignores processes with a different run id", async () => {
    const ours = randomUUID();
    const other = randomUUID();
    const child = spawnSleepWithRunId(other);
    live.push(child);
    await new Promise((r) => setTimeout(r, 50));

    const hits = listProcessesWithTestRunId(ours);
    assert.equal(
      hits.find((h) => h.pid === child.pid),
      undefined,
    );

    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
  });

  it("collectAncestorPids includes parent", () => {
    const ancestors = collectAncestorPids(process.pid);
    assert.ok(ancestors.has(process.ppid));
  });
});
