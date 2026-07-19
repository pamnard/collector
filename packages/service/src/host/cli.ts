#!/usr/bin/env node
/**
 * CLI entry for Collector service domain host (#151/#152/#237).
 *
 * Usage:
 *   node packages/service/dist/host/cli.js serve --data-dir <dir> [--port 0] [--host 127.0.0.1] [--ipc-path <path>|--no-ipc]
 *
 * Prints `COLLECTOR_SERVICE_READY {...}` when listening, then waits for SIGINT/SIGTERM.
 * Out-of-band smokes call this directly. The Tauri sidecar `collector-service serve`
 * also launches this Node entry when supervise is enabled (#166/#237). Default app
 * path still does not spawn it until cutover (#170).
 */

import { startServiceHost, formatServiceHostReadyLine } from "./service-host.js";

function usage(): never {
  console.error(
    "Usage: collector-service serve --data-dir <path> [--port 0] [--host 127.0.0.1] [--ipc-path <path>|--no-ipc]",
  );
  process.exit(2);
}

function readArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) {
    return undefined;
  }
  return argv[idx + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command !== "serve") {
    usage();
  }

  const dataDir = readArg(rest, "--data-dir");
  if (!dataDir) {
    usage();
  }

  const portRaw = readArg(rest, "--port");
  const host = readArg(rest, "--host") ?? "127.0.0.1";
  const port = portRaw === undefined ? 0 : Number(portRaw);
  if (!Number.isInteger(port) || port < 0) {
    console.error("Invalid --port");
    process.exit(2);
  }

  let ipcPath: string | false | undefined;
  if (hasFlag(rest, "--no-ipc")) {
    ipcPath = false;
  } else if (readArg(rest, "--ipc-path") !== undefined) {
    const value = readArg(rest, "--ipc-path");
    if (!value) {
      console.error("Missing value for --ipc-path");
      process.exit(2);
    }
    ipcPath = value;
  }

  const service = await startServiceHost({ dataDir, host, port, ipcPath });
  console.log(formatServiceHostReadyLine(service));

  const shutdown = async (signal: string) => {
    console.error(`[collector-service] shutting down (${signal})`);
    await service.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    "[collector-service] fatal:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
