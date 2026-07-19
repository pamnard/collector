#!/usr/bin/env node
/**
 * CLI entry for out-of-band Collector service host (#151).
 *
 * Usage:
 *   node packages/service/dist/host/cli.js serve --data-dir <dir> [--port 0] [--host 127.0.0.1]
 *
 * Prints `COLLECTOR_SERVICE_READY {...}` when listening, then waits for SIGINT/SIGTERM.
 * Not started by the Tauri app.
 */

import { startServiceHost, formatServiceHostReadyLine } from "./service-host.js";

function usage(): never {
  console.error(
    "Usage: collector-service serve --data-dir <path> [--port 0] [--host 127.0.0.1]",
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

  const service = await startServiceHost({ dataDir, host, port });
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
