/**
 * Read-only Collector CLI over service IPC (#172).
 * Never opens SQLite — dials the running local service only.
 */

import { connectCollectorIpcClient } from "@collector/client/node";
import {
  defaultServiceIpcPath,
  isServiceIpcError,
} from "@collector/service/host";
import { CliUsageError, parseCliArgs, type ParsedCliArgs } from "./parse-args.js";

export { parseCliArgs, CliUsageError };

function resolveIpcPath(args: ParsedCliArgs): string {
  if (args.ipcPath !== undefined) {
    return args.ipcPath;
  }
  if (args.dataDir === undefined) {
    throw new CliUsageError("missing endpoint");
  }
  return defaultServiceIpcPath(args.dataDir);
}

function formatConnectFailure(error: unknown, ipcPath: string): string {
  if (isServiceIpcError(error) && error.code === "not_connected") {
    return `Collector service is not running (IPC ${ipcPath}): ${error.message}`;
  }
  if (error instanceof Error) {
    return `Failed to reach Collector service at ${ipcPath}: ${error.message}`;
  }
  return `Failed to reach Collector service at ${ipcPath}`;
}

export async function runCollectorCli(
  argv: string[],
  io: { stdout: (line: string) => void; stderr: (line: string) => void } = {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  },
): Promise<number> {
  let args: ParsedCliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    const message =
      error instanceof CliUsageError ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  const ipcPath = resolveIpcPath(args);
  let client;
  try {
    client = await connectCollectorIpcClient(ipcPath, {
      connectTimeoutMs: 2_000,
    });
  } catch (error) {
    io.stderr(formatConnectFailure(error, ipcPath));
    return 1;
  }

  try {
    if (args.command.name === "health") {
      const health = await client.health();
      io.stdout(JSON.stringify(health, null, 2));
      return 0;
    }
    if (args.command.name === "search") {
      const items = await client.searchItems(args.command.query, "all");
      io.stdout(
        JSON.stringify(
          items.map((item) => ({
            id: item.id,
            title: item.title,
            folder_path: item.folder_path,
          })),
          null,
          2,
        ),
      );
      return 0;
    }
    const result = await client.getItemById(args.command.itemId);
    io.stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    if (isServiceIpcError(error)) {
      io.stderr(`${error.code}: ${error.message}`);
      return 1;
    }
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await client.close();
  }
}
