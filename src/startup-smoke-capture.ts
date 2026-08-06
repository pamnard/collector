/**
 * Startup smoke capture (#555).
 * Without Tauri FS, smoke mode is inactive — handlers still attach for console.
 */

const lines: string[] = [];
let active = false;

function record(kind: string, detail: string): void {
  lines.push(`[${new Date().toISOString()}] ${kind}: ${detail}`);
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

/** No-op without Tauri smoke flag files (#555). */
export async function markSmokeUiReady(_detail: {
  width: number;
  height: number;
  selector: string;
}): Promise<void> {
  return;
}

export async function setupStartupSmokeCapture(): Promise<void> {
  attachGlobalHandlers();
  active = false;
  lines.length = 0;
}
