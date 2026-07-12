import { appConfigDir, join } from "@tauri-apps/api/path";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";

const SMOKE_FLAG = "smoke-mode.flag";
const SMOKE_LOG = "smoke-errors.log";

let active = false;
let logPath = "";
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

function attachGlobalHandlers(): void {
  window.addEventListener("error", (event) => {
    record("window.error", event.message || String(event.error ?? "unknown"));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    record(
      "unhandledrejection",
      reason instanceof Error ? reason.message : String(reason),
    );
  });

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    record("console.error", args.map(String).join(" "));
    originalError(...args);
  };
}

export async function setupStartupSmokeCapture(): Promise<void> {
  attachGlobalHandlers();

  try {
    const flagPath = await join(await appConfigDir(), SMOKE_FLAG);
    if (!(await exists(flagPath))) {
      lines.length = 0;
      return;
    }

    active = true;
    logPath = await join(await appConfigDir(), SMOKE_LOG);
    lines.length = 0;
    await persist();
  } catch {
    lines.length = 0;
    active = false;
    logPath = "";
  }
}
