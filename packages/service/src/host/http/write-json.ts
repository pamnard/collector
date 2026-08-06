/**
 * Shared JSON + CORS response helper for host HTTP surfaces (#550 cleanup B).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { corsHeadersForRequest } from "./cors.js";

export function writeJson(
  req: IncomingMessage,
  res: ServerResponse,
  code: number,
  body: unknown,
): void {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    ...corsHeadersForRequest(req),
  });
  res.end(payload);
}
