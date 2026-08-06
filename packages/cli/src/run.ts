/**
 * Collector CLI over service IPC (#172/#173 / #369).
 * Never opens SQLite — dials the running local service only.
 */

import { connectCollectorHostService } from "@collector/client/node";
import {
  defaultHostWirePath,
  isHostWireError,
} from "@collector/service/host";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { CliUsageError, parseCliArgs, type ParsedCliArgs } from "./parse-args.js";

export { parseCliArgs, CliUsageError };

function resolveIpcPath(args: ParsedCliArgs): string {
  if (args.ipcPath !== undefined) {
    return args.ipcPath;
  }
  if (args.dataDir === undefined) {
    throw new CliUsageError("missing endpoint");
  }
  return defaultHostWirePath(args.dataDir);
}

function formatConnectFailure(error: unknown, ipcPath: string): string {
  if (
    isHostWireError(error) &&
    (error.code === "not_connected" || error.code === "token_missing")
  ) {
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
    client = await connectCollectorHostService(ipcPath, {
      connectTimeoutMs: 2_000,
      ...(args.dataDir === undefined ? {} : { dataDir: args.dataDir }),
      ...(args.token === undefined ? {} : { token: args.token }),
    });
  } catch (error) {
    io.stderr(formatConnectFailure(error, ipcPath));
    return 1;
  }

  try {
    const cmd = args.command;
    if (cmd.name === "health") {
      const health = await client.health();
      io.stdout(JSON.stringify(health, null, 2));
      return 0;
    }
    if (cmd.name === "search") {
      const items = await client.items.searchItems(cmd.query, "all");
      io.stdout(JSON.stringify(items, null, 2));
      return 0;
    }
    if (cmd.name === "get-item") {
      const result = await client.items.getItemById(cmd.itemId);
      io.stdout(JSON.stringify(result, null, 2));
      return 0;
    }
    if (cmd.name === "get-item-source") {
      const raw = await client.items.getItemSource(cmd.itemId);
      io.stdout(raw);
      return 0;
    }
    if (cmd.name === "create-item") {
      const item = await client.items.createItem({
        title: cmd.title,
        content_type: cmd.content_type,
        ...(cmd.description === undefined ? {} : { description: cmd.description }),
        ...(cmd.url === undefined ? {} : { url: cmd.url }),
        ...(cmd.content === undefined ? {} : { content: cmd.content }),
        ...(cmd.folder_path === undefined ? {} : { folder_path: cmd.folder_path }),
      });
      io.stdout(JSON.stringify(item, null, 2));
      return 0;
    }
    if (cmd.name === "update-item") {
      const item = await client.items.updateItem(cmd.itemId, {
        ...(cmd.title === undefined ? {} : { title: cmd.title }),
        ...(cmd.description === undefined ? {} : { description: cmd.description }),
        ...(cmd.url === undefined ? {} : { url: cmd.url }),
        ...(cmd.content === undefined ? {} : { content: cmd.content }),
        ...(cmd.content_type === undefined
          ? {}
          : { content_type: cmd.content_type }),
        ...(cmd.tags === undefined ? {} : { tags: cmd.tags }),
        ...(cmd.folder_path === undefined ? {} : { folder_path: cmd.folder_path }),
      });
      io.stdout(JSON.stringify(item, null, 2));
      return 0;
    }
    if (cmd.name === "update-item-source") {
      const item = await client.items.updateItemSource(
        cmd.itemId,
        cmd.rawMarkdown,
      );
      io.stdout(JSON.stringify(item, null, 2));
      return 0;
    }
    if (cmd.name === "delete-item") {
      await client.items.deleteItem(cmd.itemId);
      io.stdout(JSON.stringify({ ok: true, deleted: cmd.itemId }));
      return 0;
    }
    if (cmd.name === "create-tag") {
      const tag = await client.tags.createTag({
        name: cmd.tagName,
        ...(cmd.color === undefined ? {} : { color: cmd.color }),
      });
      io.stdout(JSON.stringify(tag, null, 2));
      return 0;
    }
    if (cmd.name === "delete-tag") {
      await client.tags.deleteTag(cmd.tagId);
      io.stdout(JSON.stringify({ ok: true, deleted: cmd.tagId }));
      return 0;
    }
    if (cmd.name === "create-folder") {
      const path = await client.folders.createFolder(cmd.folderPath);
      io.stdout(JSON.stringify({ ok: true, path }, null, 2));
      return 0;
    }
    if (cmd.name === "list-folders") {
      const tree = await client.folders.listFolderTree();
      io.stdout(JSON.stringify(tree, null, 2));
      return 0;
    }
    if (cmd.name === "rename-folder" || cmd.name === "move-folder") {
      const path = await client.folders.renameFolder(cmd.oldPath, cmd.newPath);
      io.stdout(JSON.stringify({ ok: true, path }, null, 2));
      return 0;
    }
    if (cmd.name === "delete-folder") {
      await client.folders.deleteFolder(cmd.folderPath);
      io.stdout(JSON.stringify({ ok: true, deleted: cmd.folderPath }));
      return 0;
    }
    if (cmd.name === "move-item") {
      const moved = await client.folders.moveItemToFolderPath(
        cmd.itemId,
        cmd.folderPath,
      );
      io.stdout(
        JSON.stringify({
          ok: true,
          itemId: moved.id,
          folder_path: moved.folder_path,
          item: moved,
        }),
      );
      return 0;
    }
    if (cmd.name === "list-item-media") {
      const media = await client.media.listItemMedia(cmd.itemId);
      io.stdout(JSON.stringify(media, null, 2));
      return 0;
    }
    if (cmd.name === "attach-media") {
      const data = new Uint8Array(await readFile(cmd.filePath));
      const filename = cmd.filename ?? basename(cmd.filePath);
      const attached = await client.media.attachMediaFiles(cmd.itemId, [
        { name: filename, bytes: data },
      ]);
      io.stdout(JSON.stringify(attached[0] ?? attached, null, 2));
      return 0;
    }
    if (cmd.name === "replace-media") {
      const data = new Uint8Array(await readFile(cmd.filePath));
      const filename = cmd.filename ?? basename(cmd.filePath);
      const replaced = await client.media.replaceItemMedia(
        cmd.itemId,
        cmd.mediaId,
        {
          name: filename,
          bytes: data,
        },
      );
      io.stdout(JSON.stringify(replaced, null, 2));
      return 0;
    }
    if (cmd.name === "delete-media") {
      await client.media.deleteItemMedia(cmd.itemId, cmd.mediaId);
      io.stdout(JSON.stringify({ ok: true, deleted: cmd.mediaId }));
      return 0;
    }
    if (cmd.name === "set-item-cover") {
      const item = await client.media.setItemCoverFromMedia(
        cmd.itemId,
        cmd.mediaId,
      );
      io.stdout(JSON.stringify(item, null, 2));
      return 0;
    }
    const _exhaustive: never = cmd;
    throw new Error(`unhandled command: ${JSON.stringify(_exhaustive)}`);
  } catch (error) {
    if (isHostWireError(error)) {
      io.stderr(`${error.code}: ${error.message}`);
      return 1;
    }
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await client.close();
  }
}
