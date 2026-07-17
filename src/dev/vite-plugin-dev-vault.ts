import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { access, constants, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import type { ItemFile } from "@collector/shared";
import {
  buildFolderTreeFromSources,
  dirname,
  joinSegments,
  listFolderRelativePaths,
  listItemRelativePaths,
  listMediaFiles,
  mediaFilePath,
  readItemFile,
  readVaultMeta,
  type TagWithCount,
} from "@collector/core";
import { NodeFileSystemAdapter } from "../../packages/core/src/adapters/node-fs";
import { readTagsFile } from "../../packages/core/src/vault/tag-io";
import {
  DEV_VAULT_FS_PREFIX,
  DEV_VAULT_SNAPSHOT_PATH,
  type DevVaultSnapshot,
} from "./dev-vault-types";

export {
  DEV_VAULT_FS_PREFIX,
  DEV_VAULT_SNAPSHOT_PATH,
  type DevVaultSnapshot,
} from "./dev-vault-types";

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

function vaultRootFromEnv(): string | null {
  const raw = process.env.COLLECTOR_WEB_VAULT?.trim();
  if (!raw) {
    return null;
  }
  return resolve(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function resolveUnderVault(vaultRoot: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const resolvedRoot = resolve(vaultRoot);
  const candidate = resolve(resolvedRoot, decoded);
  const rel = relative(resolvedRoot, candidate);
  if (rel.startsWith("..") || rel === "") {
    return null;
  }
  return candidate;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function countRowsFromItems(
  items: ItemFile[],
): Array<{ folder_path: string; item_count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.folder_path) {
      continue;
    }
    counts.set(item.folder_path, (counts.get(item.folder_path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([folder_path, item_count]) => ({
    folder_path,
    item_count,
  }));
}

function vaultFsUrl(...parts: string[]): string {
  return `${DEV_VAULT_FS_PREFIX}/${joinSegments(...parts)}`;
}

/** Same rules as Tauri `resolve_one_thumbnail`: item.thumbnail file, else first image media. */
async function resolveThumbnailUrl(
  fs: NodeFileSystemAdapter,
  vaultRoot: string,
  item: ItemFile,
): Promise<string | null> {
  if (item.thumbnail) {
    if (
      item.thumbnail.startsWith("http://") ||
      item.thumbnail.startsWith("https://")
    ) {
      return item.thumbnail;
    }
    if (item.thumbnail.startsWith("/")) {
      return item.thumbnail;
    }
    const folder = dirname(item.id);
    const relativePath = folder
      ? joinSegments(folder, item.thumbnail)
      : item.thumbnail;
    if (await fs.exists(joinSegments(vaultRoot, relativePath))) {
      return vaultFsUrl(relativePath);
    }
  }

  const mediaFiles = await listMediaFiles(fs, vaultRoot, item.id);
  for (const file of mediaFiles) {
    if (file.media_type !== "image") {
      continue;
    }
    const onDisk = mediaFilePath(vaultRoot, item.id, file.id, file.filename);
    if (!(await fs.exists(onDisk))) {
      continue;
    }
    return vaultFsUrl(mediaFilePath("", item.id, file.id, file.filename));
  }

  return null;
}

async function buildSnapshot(vaultRoot: string): Promise<DevVaultSnapshot> {
  const fs = new NodeFileSystemAdapter();
  const vault = await readVaultMeta(fs, vaultRoot);
  const itemIds = await listItemRelativePaths(fs, vaultRoot);
  const items: ItemFile[] = [];
  const thumbnailUrls: Record<string, string | null> = {};

  for (const itemId of itemIds) {
    try {
      const item = await readItemFile(fs, vaultRoot, itemId, vault.id);
      items.push(item);
      thumbnailUrls[item.id] = await resolveThumbnailUrl(fs, vaultRoot, item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dev-vault] skip item ${itemId}: ${message}`);
    }
  }

  const tagsFile = await readTagsFile(fs, vaultRoot);
  const tags: TagWithCount[] = tagsFile.tags.map((tag) => ({
    ...tag,
    item_count: items.filter((item) => item.tag_ids.includes(tag.id)).length,
  }));

  const diskFolderPaths = await listFolderRelativePaths(fs, vaultRoot);
  const folderTree = buildFolderTreeFromSources(
    diskFolderPaths,
    countRowsFromItems(items),
  );

  return { vault, items, tags, folderTree, thumbnailUrls };
}

async function handleSnapshot(
  res: ServerResponse,
  vaultRoot: string | null,
): Promise<void> {
  if (!vaultRoot) {
    sendText(res, 404, "COLLECTOR_WEB_VAULT is not set");
    return;
  }

  if (!(await pathExists(vaultRoot))) {
    console.warn(`[dev-vault] vault path does not exist: ${vaultRoot}`);
    sendText(res, 404, "Vault path does not exist");
    return;
  }

  try {
    const snapshot = await buildSnapshot(vaultRoot);
    sendJson(res, 200, snapshot);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dev-vault] snapshot failed: ${message}`);
    sendText(res, 500, message);
  }
}

async function handleStaticFile(
  res: ServerResponse,
  vaultRoot: string | null,
  relUrlPath: string,
): Promise<void> {
  if (!vaultRoot) {
    sendText(res, 404, "COLLECTOR_WEB_VAULT is not set");
    return;
  }

  const filePath = resolveUnderVault(vaultRoot, relUrlPath);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!(await pathExists(filePath))) {
    sendText(res, 404, "Not found");
    return;
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  const mime = MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(fileStat.size));
  createReadStream(filePath).pipe(res);
}

function requestPath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

/**
 * DEV-only Vite middleware: read a real vault from COLLECTOR_WEB_VAULT (no SQLite).
 */
export function collectorDevVaultPlugin(): Plugin {
  return {
    name: "collector-dev-vault",
    apply: "serve",
    configureServer(server) {
      const vaultRoot = vaultRootFromEnv();
      if (vaultRoot) {
        console.info(`[dev-vault] serving vault from ${vaultRoot}`);
      } else {
        console.info(
          "[dev-vault] COLLECTOR_WEB_VAULT unset — snapshot returns 404 (synthetic mock)",
        );
      }

      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        const path = requestPath(req);

        if (path === DEV_VAULT_SNAPSHOT_PATH) {
          void handleSnapshot(res, vaultRoot);
          return;
        }

        if (path.startsWith(`${DEV_VAULT_FS_PREFIX}/`)) {
          const rel = path.slice(DEV_VAULT_FS_PREFIX.length + 1);
          void handleStaticFile(res, vaultRoot, rel);
          return;
        }

        next();
      });
    },
  };
}
