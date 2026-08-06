import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AlreadyLockedError,
  SERVICE_LOCK_MAGIC,
  acquireServiceLock,
  cleanupOrphans,
  formatLock,
  parseLock,
  readLock,
  serviceLockPath,
  writeLock,
} from "./service-lock.js";

describe("service-lock", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("format/parse round-trip matches Rust lock contract", () => {
    const text = formatLock({ servicePid: 42, supervisorPid: 7 });
    expect(text).toBe(
      `${SERVICE_LOCK_MAGIC}\nservice_pid=42\nsupervisor_pid=7\n`,
    );
    expect(parseLock(text)).toEqual({ servicePid: 42, supervisorPid: 7 });
  });

  it("parseLock rejects bad magic or missing service_pid", () => {
    expect(parseLock("NOT_A_LOCK\nservice_pid=1\n")).toBeNull();
    expect(parseLock(`${SERVICE_LOCK_MAGIC}\nsupervisor_pid=1\n`)).toBeNull();
  });

  it("acquire writes lock for this process; second acquire fails loudly", () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-service-lock-"));
    dirs.push(dir);

    const guard = acquireServiceLock(dir);
    const info = readLock(dir);
    expect(info).toEqual({
      servicePid: process.pid,
      supervisorPid: 0,
    });
    expect(readFileSync(serviceLockPath(dir), "utf8")).toContain(
      `service_pid=${process.pid}`,
    );

    expect(() => acquireServiceLock(dir)).toThrow(AlreadyLockedError);
    try {
      acquireServiceLock(dir);
    } catch (error) {
      expect(error).toBeInstanceOf(AlreadyLockedError);
      expect((error as AlreadyLockedError).servicePid).toBe(process.pid);
    }

    guard.release();
    expect(readLock(dir)).toBeNull();
    expect(existsSync(serviceLockPath(dir))).toBe(false);

    const again = acquireServiceLock(dir);
    expect(readLock(dir)?.servicePid).toBe(process.pid);
    again.release();
  });

  it("cleanupOrphans removes stale lock when pid is dead", () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-service-lock-stale-"));
    dirs.push(dir);
    writeLock(dir, { servicePid: 4_294_967_294, supervisorPid: 4_294_967_293 });
    expect(cleanupOrphans(dir)).toEqual({ kind: "removedStale" });
    expect(readLock(dir)).toBeNull();
  });

  it("cleanupOrphans reports liveHolder when this process holds the lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-service-lock-live-"));
    dirs.push(dir);
    const guard = acquireServiceLock(dir);
    const outcome = cleanupOrphans(dir);
    expect(outcome.kind).toBe("liveHolder");
    if (outcome.kind === "liveHolder") {
      expect(outcome.servicePid).toBe(process.pid);
    }
    guard.release();
  });

  it("acquire overwrites corrupt lock file", () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-service-lock-junk-"));
    dirs.push(dir);
    writeFileSync(serviceLockPath(dir), "garbage\n", "utf8");
    expect(parseLock(readFileSync(serviceLockPath(dir), "utf8"))).toBeNull();
    const guard = acquireServiceLock(dir);
    expect(readLock(dir)?.servicePid).toBe(process.pid);
    guard.release();
  });
});
