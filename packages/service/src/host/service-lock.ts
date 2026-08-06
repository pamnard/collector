/**
 * Sole-writer lock for the domain host (#554 / epic #550).
 *
 * Same on-disk format as the former Rust sidecar lock (`COLLECTOR_SERVICE_LOCK_V1`)
 * so Tauri supervise cleanup and Node serve share one contract. Acquire here
 * before opening SQLite; release on host shutdown.
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const SERVICE_LOCK_FILENAME = "collector-service.lock";
export const SERVICE_LOCK_MAGIC = "COLLECTOR_SERVICE_LOCK_V1";
export const SUPERVISOR_PID_ENV = "COLLECTOR_SERVICE_SUPERVISOR_PID";

export type LockInfo = {
  servicePid: number;
  supervisorPid: number;
};

export type CleanupOutcome =
  | { kind: "noLock" }
  | { kind: "removedStale" }
  | { kind: "cleanedOrphan"; servicePid: number }
  | { kind: "liveHolder"; servicePid: number; supervisorPid: number };

export class AlreadyLockedError extends Error {
  readonly servicePid: number;

  constructor(servicePid: number) {
    super(`service lock already held by pid ${servicePid}`);
    this.name = "AlreadyLockedError";
    this.servicePid = servicePid;
  }
}

export function serviceLockPath(dataDir: string): string {
  return join(dataDir, SERVICE_LOCK_FILENAME);
}

export function formatLock(info: LockInfo): string {
  return `${SERVICE_LOCK_MAGIC}\nservice_pid=${info.servicePid}\nsupervisor_pid=${info.supervisorPid}\n`;
}

export function parseLock(text: string): LockInfo | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== SERVICE_LOCK_MAGIC) {
    return null;
  }
  let servicePid: number | undefined;
  let supervisorPid = 0;
  for (const line of lines.slice(1)) {
    if (line.startsWith("service_pid=")) {
      const n = Number.parseInt(line.slice("service_pid=".length).trim(), 10);
      if (Number.isInteger(n) && n > 0) {
        servicePid = n;
      }
    } else if (line.startsWith("supervisor_pid=")) {
      const n = Number.parseInt(line.slice("supervisor_pid=".length).trim(), 10);
      supervisorPid = Number.isInteger(n) && n > 0 ? n : 0;
    }
  }
  if (servicePid === undefined) {
    return null;
  }
  return { servicePid, supervisorPid };
}

export function readLock(dataDir: string): LockInfo | null {
  const path = serviceLockPath(dataDir);
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, "utf8");
  return parseLock(text);
}

export function writeLock(dataDir: string, info: LockInfo): void {
  mkdirSync(dataDir, { recursive: true });
  const path = serviceLockPath(dataDir);
  const tmp = join(dataDir, `${SERVICE_LOCK_FILENAME}.tmp.${process.pid}`);
  writeFileSync(tmp, formatLock(info), { encoding: "utf8" });
  renameSync(tmp, path);
}

export function removeLock(dataDir: string): void {
  const path = serviceLockPath(dataDir);
  try {
    unlinkSync(path);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

/**
 * True when cmdline looks like the domain host or legacy Rust sidecar.
 * Linux: read /proc; elsewhere trust pid liveness only.
 */
export function looksLikeCollectorService(pid: number): boolean {
  // Same process that wrote the lock — always treat as our host (unit tests,
  // and any in-process holder without a cli.js cmdline).
  if (pid === process.pid) {
    return true;
  }
  if (process.platform !== "linux") {
    return true;
  }
  try {
    const bytes = readFileSync(`/proc/${pid}/cmdline`);
    const parts = bytes.toString("utf8").split("\0").filter(Boolean);
    return parts.some((part) => {
      const base = part.split(/[/\\]/).pop() ?? part;
      if (base.startsWith("collector-service")) {
        return true;
      }
      if (
        base === "cli.js" ||
        part.includes("/host/cli.js") ||
        part.endsWith("host/cli.js")
      ) {
        return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}

function processPpid(pid: number): number | null {
  if (process.platform !== "linux") {
    return null;
  }
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    for (const line of text.split("\n")) {
      if (line.startsWith("PPid:")) {
        const n = Number.parseInt(line.slice("PPid:".length).trim(), 10);
        return Number.isInteger(n) && n > 0 ? n : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function effectiveSupervisorPid(info: LockInfo): number | null {
  if (info.supervisorPid !== 0) {
    return info.supervisorPid;
  }
  return processPpid(info.servicePid);
}

function killProcess(pid: number): void {
  if (!processAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  const deadline = Date.now() + 2000;
  while (processAlive(pid) && Date.now() < deadline) {
    // brief spin while reclaiming an orphan writer
  }
  if (processAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
    const killDeadline = Date.now() + 500;
    while (processAlive(pid) && Date.now() < killDeadline) {
      // wait for SIGKILL reaping
    }
  }
}

export function cleanupOrphans(dataDir: string): CleanupOutcome {
  const info = readLock(dataDir);
  if (!info) {
    return { kind: "noLock" };
  }

  if (!processAlive(info.servicePid) || !looksLikeCollectorService(info.servicePid)) {
    removeLock(dataDir);
    return { kind: "removedStale" };
  }

  const supervisor = effectiveSupervisorPid(info);
  if (supervisor !== null && processAlive(supervisor)) {
    return {
      kind: "liveHolder",
      servicePid: info.servicePid,
      supervisorPid: supervisor,
    };
  }

  killProcess(info.servicePid);
  removeLock(dataDir);
  return { kind: "cleanedOrphan", servicePid: info.servicePid };
}

export type ServiceLockGuard = {
  dataDir: string;
  release: () => void;
};

/**
 * Acquire sole-writer lock. Refuses if a live holder still has a live supervisor.
 */
export function acquireServiceLock(dataDir: string): ServiceLockGuard {
  const existing = readLock(dataDir);
  if (existing) {
    if (
      processAlive(existing.servicePid) &&
      looksLikeCollectorService(existing.servicePid)
    ) {
      const supervisor = effectiveSupervisorPid(existing);
      if (supervisor !== null && processAlive(supervisor)) {
        throw new AlreadyLockedError(existing.servicePid);
      }
      killProcess(existing.servicePid);
    }
    removeLock(dataDir);
  }

  const fromEnv = process.env[SUPERVISOR_PID_ENV];
  const supervisorPid =
    fromEnv !== undefined && fromEnv.trim() !== ""
      ? Number.parseInt(fromEnv.trim(), 10)
      : 0;
  const info: LockInfo = {
    servicePid: process.pid,
    supervisorPid:
      Number.isInteger(supervisorPid) && supervisorPid > 0 ? supervisorPid : 0,
  };
  writeLock(dataDir, info);

  let released = false;
  return {
    dataDir,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      removeLock(dataDir);
    },
  };
}
