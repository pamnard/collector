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
