/**
 * Host HTTP request promise settlement (#933).
 * Maps unexpected handler throws to JSON 500 so the process stays up.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mapHandlerThrownToApiError } from "../wire/errors.js";
import { writeJson } from "./write-json.js";

/**
 * Run an async HTTP handler and convert uncaught errors into a JSON response.
 * If headers were already sent, logs and swallows (cannot recover the response).
 */
export function runServiceHostHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  run: () => Promise<void>,
): void {
  void run().catch((error: unknown) => {
    console.error("[collector] host HTTP request failed:", error);
    if (res.headersSent) {
      return;
    }
    writeJson(req, res, 500, {
      ok: false,
      error: mapHandlerThrownToApiError(error),
    });
  });
}
