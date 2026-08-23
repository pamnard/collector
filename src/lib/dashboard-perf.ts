/**
 * Dashboard perf diagnostics — active only when `?dashboardPerf=1` or
 * localStorage `collector_dashboard_perf=1`.
 */

export type DashboardPerfPhase =
  | "queryIndex"
  | "applyIndexPage"
  | "commitList"
  | "coverFlight"
  | "loadingOff"
  | "intersectCommitted"
  | "gridMount"
  | "gridLayout"
  | "tableMount"
  | "coverDecode";

export type DashboardPerfRunKind = "folder" | "viewMode";

export type DashboardPerfViewMode = "grid" | "table";

export type DashboardPerfRunMeta = {
  viewMode: DashboardPerfViewMode;
  folderPath?: string;
  scenario?: string;
};

export type DashboardPerfRunStatus =
  | "running"
  | "complete"
  | "aborted"
  | "timeout";

export type DashboardPerfRun = {
  runId: string;
  kind: DashboardPerfRunKind;
  meta: DashboardPerfRunMeta;
  startedAt: number;
  phases: Partial<Record<DashboardPerfPhase, number>>;
  l1Ms: number | null;
  l2Ms: number | null;
  l3Ms: number | null;
  intersectClearedCommitted: boolean | null;
  itemCount: number | null;
  status: DashboardPerfRunStatus;
  endedAt: number | null;
};

export type DashboardPerfBridge = {
  runs: DashboardPerfRun[];
  getActiveRunId: () => string | null;
  setNextScenario: (scenario: string | undefined) => void;
  waitForRun: (runId: string, timeoutMs?: number) => Promise<DashboardPerfRun>;
  dump: () => DashboardPerfRun[];
  clear: () => void;
};

declare global {
  interface Window {
    __collectorDashboardPerf?: DashboardPerfBridge;
  }
}

const STORAGE_KEY = "collector_dashboard_perf";
const MAX_RUNS = 50;
const DEFAULT_WAIT_MS = 30_000;

let enabled = false;
let activeRunId: string | null = null;
let nextScenario: string | undefined;
const runs: DashboardPerfRun[] = [];
const phaseStarts = new Map<string, number>();

function nowMs(): number {
  return performance.now();
}

function findRun(runId: string): DashboardPerfRun | undefined {
  return runs.find((run) => run.runId === runId);
}

function phaseKey(runId: string, phase: DashboardPerfPhase): string {
  return `${runId}:${phase}`;
}

function markRunEnded(run: DashboardPerfRun, status: DashboardPerfRunStatus): void {
  run.status = status;
  run.endedAt = Date.now();
  if (activeRunId === run.runId) {
    activeRunId = null;
  }
}

export function initDashboardPerfFromLocation(): void {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("dashboardPerf") === "1") {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore quota / private mode
    }
    enabled = true;
    installDashboardPerfBridge();
    return;
  }
  try {
    enabled = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    enabled = false;
  }
  if (enabled) {
    installDashboardPerfBridge();
  }
}

/** Test hook: force-enable without window. */
export function setDashboardPerfEnabledForTests(value: boolean): void {
  enabled = value;
  if (!value) {
    activeRunId = null;
    runs.length = 0;
    phaseStarts.clear();
  }
}

export function isDashboardPerfEnabled(): boolean {
  return enabled;
}

export function dashboardPerfGetActiveRunId(): string | null {
  return activeRunId;
}

export function dashboardPerfActiveRunId(): string | null {
  return isDashboardPerfEnabled() ? activeRunId : null;
}

export function dashboardPerfRunExpectsViewMode(
  runId: string | null,
  viewMode: DashboardPerfViewMode,
): boolean {
  if (!runId) {
    return false;
  }
  const run = findRun(runId);
  return run?.status === "running" && run.meta.viewMode === viewMode;
}

export function dashboardPerfSetNextScenario(scenario: string | undefined): void {
  nextScenario = scenario;
}

export function dashboardPerfBeginRun(
  kind: DashboardPerfRunKind,
  meta: DashboardPerfRunMeta,
): string | null {
  if (!enabled) {
    return null;
  }
  if (activeRunId) {
    const prev = findRun(activeRunId);
    if (prev && prev.status === "running") {
      markRunEnded(prev, "aborted");
    }
  }
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const run: DashboardPerfRun = {
    runId,
    kind,
    meta: {
      ...meta,
      scenario: meta.scenario ?? nextScenario,
    },
    startedAt: nowMs(),
    phases: {},
    l1Ms: null,
    l2Ms: null,
    l3Ms: null,
    intersectClearedCommitted: null,
    itemCount: null,
    status: "running",
    endedAt: null,
  };
  runs.push(run);
  if (runs.length > MAX_RUNS) {
    runs.splice(0, runs.length - MAX_RUNS);
  }
  activeRunId = runId;
  nextScenario = undefined;
  return runId;
}

export function dashboardPerfBeginPhase(
  runId: string | null,
  phase: DashboardPerfPhase,
): void {
  if (!runId || !enabled) {
    return;
  }
  phaseStarts.set(phaseKey(runId, phase), nowMs());
}

export function dashboardPerfEndPhase(
  runId: string | null,
  phase: DashboardPerfPhase,
): void {
  if (!runId || !enabled) {
    return;
  }
  const run = findRun(runId);
  if (!run || run.status !== "running") {
    return;
  }
  const key = phaseKey(runId, phase);
  const start = phaseStarts.get(key);
  if (start === undefined) {
    return;
  }
  phaseStarts.delete(key);
  const elapsed = nowMs() - start;
  run.phases[phase] = (run.phases[phase] ?? 0) + elapsed;
}

export function dashboardPerfNoteIntersect(
  runId: string | null,
  clearedCommitted: boolean,
): void {
  if (!runId || !enabled) {
    return;
  }
  const run = findRun(runId);
  if (!run) {
    return;
  }
  run.intersectClearedCommitted = clearedCommitted;
}

export function dashboardPerfNoteItemCount(
  runId: string | null,
  itemCount: number,
): void {
  if (!runId || !enabled) {
    return;
  }
  const run = findRun(runId);
  if (!run) {
    return;
  }
  run.itemCount = itemCount;
}

function observeLevel(
  runId: string | null,
  level: "l1" | "l2" | "l3",
): void {
  if (!runId || !enabled) {
    return;
  }
  const run = findRun(runId);
  if (!run || run.status !== "running") {
    return;
  }
  const elapsed = nowMs() - run.startedAt;
  if (level === "l1" && run.l1Ms === null) {
    run.l1Ms = elapsed;
  }
  if (level === "l2" && run.l2Ms === null) {
    run.l2Ms = elapsed;
  }
  if (level === "l3" && run.l3Ms === null) {
    run.l3Ms = elapsed;
    markRunEnded(run, "complete");
  }
}

export function dashboardPerfObserveL1(runId: string | null): void {
  observeLevel(runId, "l1");
}

export function dashboardPerfObserveL2(runId: string | null): void {
  observeLevel(runId, "l2");
}

export function dashboardPerfObserveL3(runId: string | null): void {
  observeLevel(runId, "l3");
}

const coverDecodeCounts = new Map<string, number>();

export function dashboardPerfRecordCoverDecode(
  runId: string | null,
  threshold = 6,
): void {
  if (!runId || !enabled) {
    return;
  }
  const run = findRun(runId);
  if (!run || run.status !== "running") {
    return;
  }
  const next = (coverDecodeCounts.get(runId) ?? 0) + 1;
  coverDecodeCounts.set(runId, next);
  if (next >= threshold) {
    coverDecodeCounts.delete(runId);
    dashboardPerfObserveL3(runId);
  }
}

export function dashboardPerfCompleteRunWithoutL3(runId: string | null): void {
  if (!runId || !enabled) {
    return;
  }
  const run = findRun(runId);
  if (!run || run.status !== "running") {
    return;
  }
  markRunEnded(run, "complete");
}

export function dashboardPerfTimeoutRun(runId: string): void {
  const run = findRun(runId);
  if (!run || run.status !== "running") {
    return;
  }
  markRunEnded(run, "timeout");
}

export function dashboardPerfGetRuns(): readonly DashboardPerfRun[] {
  return runs;
}

export function installDashboardPerfBridge(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__collectorDashboardPerf = {
    runs,
    getActiveRunId: () => activeRunId,
    setNextScenario: (scenario) => {
      nextScenario = scenario;
    },
    waitForRun: (runId, timeoutMs = DEFAULT_WAIT_MS) =>
      new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
          const run = findRun(runId);
          if (!run) {
            reject(new Error(`dashboard perf: unknown run ${runId}`));
            return;
          }
          if (run.status !== "running") {
            resolve({ ...run, phases: { ...run.phases } });
            return;
          }
          if (Date.now() >= deadline) {
            dashboardPerfTimeoutRun(runId);
            const timed = findRun(runId);
            if (timed) {
              resolve({ ...timed, phases: { ...timed.phases } });
              return;
            }
            reject(new Error(`dashboard perf: run ${runId} timed out`));
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    dump: () => runs.map((run) => ({ ...run, phases: { ...run.phases } })),
    clear: () => {
      runs.length = 0;
      activeRunId = null;
      phaseStarts.clear();
      coverDecodeCounts.clear();
    },
  };
}
