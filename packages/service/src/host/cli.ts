#!/usr/bin/env node
/**
 * CLI entry for Collector service domain host (#151/#152/#237/#554).
 *
 * Usage:
 *   node packages/service/dist/host/cli.js serve --data-dir <dir> [--config-dir <dir>] [--port 1421] [--host 127.0.0.1] [--ui-dir <path>]
 *   `--port 0` = ephemeral (tests/smokes). Default port is DEFAULT_SERVICE_HOST_PORT (1421).
 *
 * Layout (#238): production passes --config-dir when profile dirs are split.
 * Omitting --config-dir uses self-contained `{dataDir}/config` + `{dataDir}/collector.db`.
 *
 * Sole-writer (#554): acquires `{data-dir}/collector-service.lock` before opening
 * SQLite. Second live host on the same data-dir exits loudly (code 3).
 *
 * `--ui-dir` (#555): serve packaged browser UI + GET /api/ui-bootstrap.
 *
 * Prints `COLLECTOR_SERVICE_READY {...}` when listening, then waits for SIGINT/SIGTERM.
 * Out-of-band smokes and `npm run dev:host` call this directly.
 */

import {
  AlreadyLockedError,
  acquireServiceLock,
} from "./service-lock.js";
import {
  DEFAULT_SERVICE_HOST_PORT,
  startServiceHost,
  formatServiceHostReadyLine,
  resolveServiceHostListenPort,
} from "./service-host.js";

function usage(): never {
  console.error(
    `Usage: collector-service serve --data-dir <path> [--config-dir <path>] [--port ${DEFAULT_SERVICE_HOST_PORT}] [--host 127.0.0.1] [--ui-dir <path>]`,
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

  if (rest.includes("--ipc-path") || rest.includes("--no-ipc")) {
    console.error(
      "collector-service: --ipc-path / --no-ipc removed; host is HTTP-only",
    );
    process.exit(2);
  }

  const dataDir = readArg(rest, "--data-dir");
  if (!dataDir) {
    usage();
  }
  const configDir = readArg(rest, "--config-dir");
  const uiDir = readArg(rest, "--ui-dir");

  const portRaw = readArg(rest, "--port");
  const host = readArg(rest, "--host") ?? "127.0.0.1";
  const port =
    portRaw === undefined
      ? resolveServiceHostListenPort()
      : Number(portRaw);
  if (!Number.isInteger(port) || port < 0) {
    console.error("Invalid --port");
    process.exit(2);
  }

  let lock;
  try {
    lock = acquireServiceLock(dataDir);
  } catch (error) {
    if (error instanceof AlreadyLockedError) {
      console.error(
        `collector-service: lock held by pid ${error.servicePid}`,
      );
      process.exit(3);
    }
    throw error;
  }

  const releaseLock = () => {
    lock.release();
  };
  process.on("exit", releaseLock);

  const service = await startServiceHost({
    dataDir,
    ...(configDir === undefined ? {} : { configDir }),
    ...(uiDir === undefined ? {} : { uiDir }),
    host,
    port,
  });
  console.log(formatServiceHostReadyLine(service));

  const shutdown = async (signal: string) => {
    console.error(`[collector-service] shutting down (${signal})`);
    process.off("exit", releaseLock);
    await service.close();
    lock.release();
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
