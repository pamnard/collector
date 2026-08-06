/**
 * CORS helpers for browser UI → local domain host (#551).
 * Reflect Origin when hostname is localhost or 127.0.0.1.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

export function isLocalBrowserOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  try {
    const url = new URL(origin);
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/** Headers to merge into HTTP responses when Origin is a local Vite UI. */
export function corsHeadersForRequest(
  req: IncomingMessage,
): Record<string, string> {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !isLocalBrowserOrigin(origin)) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

export function writeCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const headers = {
    ...corsHeadersForRequest(req),
    "content-length": "0",
  };
  res.writeHead(204, headers);
  res.end();
}
