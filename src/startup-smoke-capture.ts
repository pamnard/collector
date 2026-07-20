import { appConfigDir, join } from "@tauri-apps/api/path";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";

const SMOKE_FLAG = "smoke-mode.flag";
const SMOKE_LOG = "smoke-errors.log";
/** Written only after the main app shell paints (not StartupErrorScreen). */
export const SMOKE_UI_READY = "smoke-ui-ready.flag";

let active = false;
let logPath = "";
let uiReadyPath = "";
const lines: string[] = [];

async function persist(): Promise<void> {
  if (!active || !logPath) {
    return;
  }
  await writeTextFile(logPath, lines.length ? `${lines.join("\n")}\n` : "");
}

function record(kind: string, detail: string): void {
  lines.push(`[${new Date().toISOString()}] ${kind}: ${detail}`);
  void persist().catch(() => {
    // ignore log write failures during smoke
  });
}

function formatErrorDetail(value: unknown): string {
  if (value && typeof value === "object" && "issues" in value) {
    const issues = (value as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      try {
        return `ZodError ${JSON.stringify(issues)}`;
      } catch {
        return "ZodError (unserializable issues)";
      }
    }
  }
  if (value instanceof Error) {
    return value.message || value.name;
  }
  return String(value);
}

function attachGlobalHandlers(): void {
  window.addEventListener("error", (event) => {
    record(
      "window.error",
      formatErrorDetail(event.error) || event.message || "unknown",
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    record("unhandledrejection", formatErrorDetail(event.reason));
  });

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    record("console.error", args.map(String).join(" "));
    originalError(...args);
  };
}

export function isStartupSmokeActive(): boolean {
  return active;
}

/**
 * Signal that the main app WebView tree painted (shell with non-zero box).
 * No-op outside smoke mode. Must not be called from StartupErrorScreen.
 */
export async function markSmokeUiReady(detail: {
  width: number;
  height: number;
  selector: string;
}): Promise<void> {
  if (!active || !uiReadyPath) {
    return;
  }
  if (!(detail.width > 0 && detail.height > 0)) {
    record(
      "smoke.ui-ready.rejected",
      `zero-size shell ${detail.selector} ${detail.width}x${detail.height}`,
    );
    return;
  }
  const body = `${JSON.stringify({
    at: new Date().toISOString(),
    ...detail,
  })}\n`;
  // Flag alone is the pass signal — do not append to smoke-errors.log
  // (any non-empty log fails release smoke).
  await writeTextFile(uiReadyPath, body);
}

export async function setupStartupSmokeCapture(): Promise<void> {
  attachGlobalHandlers();

  try {
    const configDir = await appConfigDir();
    const flagPath = await join(configDir, SMOKE_FLAG);
    if (!(await exists(flagPath))) {
      lines.length = 0;
      return;
    }

    active = true;
    logPath = await join(configDir, SMOKE_LOG);
    uiReadyPath = await join(configDir, SMOKE_UI_READY);
    lines.length = 0;
    await persist();
  } catch {
    lines.length = 0;
    active = false;
    logPath = "";
    uiReadyPath = "";
  }
}
