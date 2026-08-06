/**
 * HTTP Bearer auth for domain host surfaces (#551).
 * Same host token as the local dial token file / COLLECTOR_IPC_TOKEN.
 */

import type { IncomingMessage } from "node:http";
import { tokensEqual } from "../ipc/auth.js";

export function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

export function isValidBearer(
  req: IncomingMessage,
  expectedToken: string,
): boolean {
  const provided = extractBearerToken(req);
  if (provided === null) {
    return false;
  }
  return tokensEqual(expectedToken, provided);
}
