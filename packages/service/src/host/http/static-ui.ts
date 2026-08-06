/**
 * Serve packaged browser UI from a directory (#555).
 * API / media / ping / health / events stay reserved.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { corsHeadersForRequest } from "./cors.js";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** Paths reserved for host HTTP surfaces — never served as static files. */
export function isReservedHostPath(pathname: string): boolean {
  if (pathname === "/ping" || pathname === "/health") {
    return true;
  }
  if (pathname === "/api/rpc" || pathname === "/api/events") {
    return true;
  }
  if (pathname === "/api/ui-bootstrap") {
    return true;
  }
  if (pathname === "/media/file" || pathname.startsWith("/media/")) {
    return true;
  }
  return false;
}

function contentTypeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Resolve a URL pathname to a file under uiDir. Rejects path escape.
 * Returns null when the path is outside uiDir.
 */
export function resolveUiFilePath(
  uiDir: string,
  pathname: string,
): string | null {
  const root = resolve(uiDir);
  const decoded = decodeURIComponent(pathname);
  const relative =
    decoded === "/" || decoded === ""
      ? "index.html"
      : decoded.replace(/^\/+/, "");
  const candidate = resolve(join(root, relative));
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return null;
  }
  // Normalize away ".." that resolve() already handled; keep for clarity.
  if (normalize(candidate) !== candidate && !candidate.startsWith(root)) {
    return null;
  }
  return candidate;
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
): void {
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    res.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      ...corsHeadersForRequest(req),
    });
    res.end(`${JSON.stringify({ ok: false, error: "not_found" })}\n`);
    return;
  }
  res.writeHead(200, {
    "content-type": contentTypeForPath(filePath),
    "content-length": String(stat.size),
    ...corsHeadersForRequest(req),
  });
  createReadStream(filePath).pipe(res);
}

/**
 * Try to serve a static UI asset. Returns true if the response was handled.
 * SPA fallback: missing non-asset paths → index.html when present.
 */
export function tryServeStaticUi(
  req: IncomingMessage,
  res: ServerResponse,
  uiDir: string,
  pathname: string,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  if (isReservedHostPath(pathname)) {
    return false;
  }

  const filePath = resolveUiFilePath(uiDir, pathname);
  if (filePath === null) {
    res.writeHead(403, {
      "content-type": "application/json; charset=utf-8",
      ...corsHeadersForRequest(req),
    });
    res.end(`${JSON.stringify({ ok: false, error: "forbidden" })}\n`);
    return true;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    if (req.method === "HEAD") {
      const stat = statSync(filePath);
      res.writeHead(200, {
        "content-type": contentTypeForPath(filePath),
        "content-length": String(stat.size),
        ...corsHeadersForRequest(req),
      });
      res.end();
      return true;
    }
    sendFile(req, res, filePath);
    return true;
  }

  // SPA fallback for client routes (no file extension or unknown path).
  const indexPath = join(resolve(uiDir), "index.html");
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    if (req.method === "HEAD") {
      const stat = statSync(indexPath);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(stat.size),
        ...corsHeadersForRequest(req),
      });
      res.end();
      return true;
    }
    sendFile(req, res, indexPath);
    return true;
  }

  return false;
}
