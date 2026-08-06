/**
 * POST /api/rpc — browser JSON-RPC into domainDispatch (#551).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CollectorApiError } from "@collector/api";
import { mapHandlerThrownToApiError } from "../wire/errors.js";
import { writeJson } from "./write-json.js";

export type DomainDispatch = (
  method: string,
  params: unknown,
) => Promise<unknown>;

export type HttpRpcBody = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function resolveRpcId(raw: unknown): string | number | null {
  if (typeof raw === "string" || typeof raw === "number") {
    return raw;
  }
  return null;
}

/**
 * Handle an authenticated POST /api/rpc request (Bearer already verified).
 */
export async function handleHttpRpc(
  req: IncomingMessage,
  res: ServerResponse,
  dispatch: DomainDispatch,
): Promise<void> {
  let raw: string;
  raw = await readRequestBody(req);

  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    const error: CollectorApiError = {
      layer: "validation",
      code: "bad_request",
      message: "RPC body must be JSON",
    };
    writeJson(req, res, 200, { id: null, error });
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error: CollectorApiError = {
      layer: "validation",
      code: "bad_request",
      message: "RPC body must be a JSON object",
    };
    writeJson(req, res, 200, { id: null, error });
    return;
  }

  const body = parsed as HttpRpcBody;
  const id = resolveRpcId(body.id);
  if (typeof body.method !== "string" || body.method.length === 0) {
    const error: CollectorApiError = {
      layer: "validation",
      code: "bad_request",
      message: "RPC method string required",
    };
    writeJson(req, res, 200, { id, error });
    return;
  }

  try {
    const result = await dispatch(body.method, body.params);
    if (result === undefined) {
      const error: CollectorApiError = {
        layer: "validation",
        code: "unknown_method",
        message: `unknown method: ${body.method}`,
      };
      writeJson(req, res, 200, { id, error });
      return;
    }
    writeJson(req, res, 200, { id, result });
  } catch (error) {
    writeJson(req, res, 200, {
      id,
      error: mapHandlerThrownToApiError(error),
    });
  }
}

export function writeUnauthorized(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const error: CollectorApiError = {
    layer: "auth",
    code: "auth_failed",
    message: "Bearer authentication required",
  };
  writeJson(req, res, 401, { ok: false, error });
}
