/**
 * Detect processes left behind by a test run.
 *
 * Fingerprint: every process spawned under `npm test` inherits
 * `COLLECTOR_TEST_RUN_ID=<uuid>`. After the suite, any live process still
 * carrying that env (except the checker and its ancestors) is a leak —
 * regardless of binary name.
 */
import { readdirSync, readFileSync } from "node:fs";

export const TEST_RUN_ID_ENV = "COLLECTOR_TEST_RUN_ID";

/**
 * @param {number} pid
 * @param {string} [procRoot]
 * @returns {string[] | null}
 */
export function readProcessEnviron(pid, procRoot = "/proc") {
  try {
    const raw = readFileSync(`${procRoot}/${pid}/environ`);
    return raw.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 * @param {string} [procRoot]
 * @returns {string}
 */
export function readProcessCmdline(pid, procRoot = "/proc") {
  try {
    return readFileSync(`${procRoot}/${pid}/cmdline`)
      .toString("utf8")
      .replace(/\0/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/**
 * @param {number} pid
 * @param {string} [procRoot]
 * @returns {number | null}
 */
export function readProcessPpid(pid, procRoot = "/proc") {
  try {
    const status = readFileSync(`${procRoot}/${pid}/status`, "utf8");
    const line = status.split("\n").find((l) => l.startsWith("PPid:"));
    if (!line) return null;
    const ppid = Number(line.slice("PPid:".length).trim());
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 * @param {string} [procRoot]
 * @returns {Set<number>}
 */
export function collectAncestorPids(pid, procRoot = "/proc") {
  const out = new Set();
  let current = readProcessPpid(pid, procRoot);
  while (current != null && current > 0 && !out.has(current)) {
    out.add(current);
    current = readProcessPpid(current, procRoot);
  }
  return out;
}

/**
 * @param {string[]} environEntries
 * @param {string} runId
 */
export function environHasTestRunId(environEntries, runId) {
  return environEntries.includes(`${TEST_RUN_ID_ENV}=${runId}`);
}

/**
 * @typedef {{ pid: number, cmdline: string }} TestRunProcess
 */

/**
 * @param {string} runId
 * @param {{ procRoot?: string, excludePids?: Iterable<number> }} [opts]
 * @returns {TestRunProcess[]}
 */
export function listProcessesWithTestRunId(runId, opts = {}) {
  if (!runId) {
    throw new Error(`${TEST_RUN_ID_ENV} is empty`);
  }
  const procRoot = opts.procRoot ?? "/proc";
  const exclude = new Set(opts.excludePids ?? []);
  /** @type {TestRunProcess[]} */
  const hits = [];
  for (const name of readdirSync(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (exclude.has(pid)) continue;
    const environ = readProcessEnviron(pid, procRoot);
    if (!environ || !environHasTestRunId(environ, runId)) continue;
    hits.push({ pid, cmdline: readProcessCmdline(pid, procRoot) });
  }
  return hits;
}

/**
 * Processes that still carry this run id and are not the checker / its parents.
 *
 * @param {string} runId
 * @param {{ procRoot?: string, selfPid?: number }} [opts]
 * @returns {TestRunProcess[]}
 */
export function listLeakedTestRunProcesses(runId, opts = {}) {
  const selfPid = opts.selfPid ?? process.pid;
  const exclude = new Set([selfPid, ...collectAncestorPids(selfPid, opts.procRoot)]);
  return listProcessesWithTestRunId(runId, {
    procRoot: opts.procRoot,
    excludePids: exclude,
  });
}
