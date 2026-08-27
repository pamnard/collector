/**
 * Collector CLI over domain-host HTTP (#172/#173 / #550 G).
 * Never opens SQLite — dials the running local host only.
 */

import {
  createCollectorHostServiceClient,
  createHttpHostTransport,
} from "@collector/client";
import {
  formatHostConnectFailure,
  isHostWireError,
} from "@collector/service/host";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { tryParseCliHelp } from "./parse-args/commands/help.js";
import { resolveCliHostEndpoint } from "./parse-args/endpoint.js";
import { CliUsageError, parseCliArgs, type ParsedCliArgs } from "./parse-args.js";

export { parseCliArgs, CliUsageError };

export async function runCollectorCli(
  argv: string[],
  io: { stdout: (line: string) => void; stderr: (line: string) => void } = {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  },
): Promise<number> {
  let args: ParsedCliArgs;
  try {
    const helpText = tryParseCliHelp(argv);
    if (helpText !== undefined) {
      io.stdout(helpText);
      return 0;
    }
    args = parseCliArgs(argv);
  } catch (error) {
    const message =
      error instanceof CliUsageError ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  let endpoint: Awaited<ReturnType<typeof resolveCliHostEndpoint>>;
  try {
    endpoint = await resolveCliHostEndpoint(args);
  } catch (error) {
    const message =
      error instanceof CliUsageError ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  let client;
  try {
    const transport = await createHttpHostTransport({
      baseUrl: endpoint.baseUrl,
      token: endpoint.token,
      connectTimeoutMs: 2_000,
    });
    client = createCollectorHostServiceClient(transport);
  } catch (error) {
    io.stderr(formatHostConnectFailure(error, endpoint.baseUrl));
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
      const result = await client.items.searchItems(cmd.query, "all");
      io.stdout(JSON.stringify(result, null, 2));
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
    if (cmd.name === "import-folder") {
      const { jobId } = await client.items.importFolder({
        sourceDirAbs: cmd.sourceDirAbs,
        ...(cmd.folder_path === undefined
          ? {}
          : { targetFolderPath: cmd.folder_path }),
      });
      if (!cmd.wait) {
        io.stdout(JSON.stringify({ jobId }, null, 2));
        return 0;
      }
      const terminal = new Set(["succeeded", "failed", "cancelled"]);
      let delayMs = 100;
      // Long-running folder imports must not inherit the 120s job-wait ceiling.
      for (;;) {
        const snapshot = await client.items.getImportFolderJob(jobId);
        if (terminal.has(snapshot.status)) {
          io.stdout(JSON.stringify(snapshot, null, 2));
          if (snapshot.status !== "succeeded") {
            return 1;
          }
          // Do not mask partial/total file failures as CLI success.
          if (!snapshot.result || snapshot.result.failed > 0) {
            return 1;
          }
          return 0;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 2_000);
      }
    }
    if (cmd.name === "wait-derived") {
      const result = await client.items.waitDerived(
        cmd.itemId,
        cmd.contentRevision,
        cmd.timeoutMs === undefined ? undefined : { timeoutMs: cmd.timeoutMs },
      );
      io.stdout(JSON.stringify(result, null, 2));
      return result.status === "succeeded" ? 0 : 1;
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
    if (cmd.name === "list-folder-items") {
      const items = await client.folders.listFolderItems(cmd.folderPath);
      io.stdout(JSON.stringify(items, null, 2));
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
    if (cmd.name === "discover-extract-candidates") {
      const candidates = await client.extract.discoverExtractCandidates(
        cmd.itemId,
      );
      io.stdout(JSON.stringify(candidates, null, 2));
      return 0;
    }
    if (cmd.name === "extract-item-candidate") {
      await client.extract.extractItemCandidate(cmd.itemId, {
        extractorId: cmd.extractorId,
        url: cmd.url,
        ...(cmd.meta === undefined ? {} : { meta: cmd.meta }),
      });
      io.stdout(
        JSON.stringify({
          ok: true,
          itemId: cmd.itemId,
          extractorId: cmd.extractorId,
        }),
      );
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
