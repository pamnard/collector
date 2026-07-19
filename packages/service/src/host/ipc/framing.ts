/**
 * Local IPC message framing + versioned envelopes (#152).
 * Wire format: 4-byte big-endian length + UTF-8 JSON body (no NDJSON).
 */

import type { CollectorApiError } from "@collector/api";
import { serviceIpcError } from "./errors.js";

/** Bump only with a coordinated client/host change. */
export const SERVICE_IPC_PROTOCOL_VERSION = 1;

export type ServiceIpcMethod = "ping" | "health";

export interface ServiceIpcHealthResult {
  ok: boolean;
  status: "healthy" | "unhealthy";
  open: boolean;
  healthy: boolean;
}

export interface ServiceIpcRequest {
  v: typeof SERVICE_IPC_PROTOCOL_VERSION;
  id: string;
  type: "req";
  method: ServiceIpcMethod;
  params?: unknown;
}

export interface ServiceIpcResponse {
  v: typeof SERVICE_IPC_PROTOCOL_VERSION;
  id: string;
  type: "res";
  result: unknown;
}

export interface ServiceIpcErrorResponse {
  v: typeof SERVICE_IPC_PROTOCOL_VERSION;
  id: string;
  type: "err";
  error: CollectorApiError;
}

export type ServiceIpcMessage =
  | ServiceIpcRequest
  | ServiceIpcResponse
  | ServiceIpcErrorResponse;

const MAX_FRAME_BYTES = 1024 * 1024;

export class ServiceIpcFramingError extends Error {
  readonly code = "framing" as const;

  constructor(message: string) {
    super(message);
    this.name = "ServiceIpcFramingError";
  }
}

export function encodeServiceIpcFrame(message: ServiceIpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_FRAME_BYTES) {
    throw new ServiceIpcFramingError(
      `frame body too large: ${body.length} > ${MAX_FRAME_BYTES}`,
    );
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Incremental length-prefixed frame reader.
 * Call `push` with socket chunks; yields complete decoded messages.
 */
export class ServiceIpcFrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): ServiceIpcMessage[] {
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : chunk;
    const messages: ServiceIpcMessage[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES) {
        throw new ServiceIpcFramingError(
          `frame length ${length} exceeds max ${MAX_FRAME_BYTES}`,
        );
      }
      if (this.buffer.length < 4 + length) {
        break;
      }
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      messages.push(decodeServiceIpcBody(body));
    }

    return messages;
  }
}

function decodeServiceIpcBody(body: Buffer): ServiceIpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ServiceIpcFramingError("frame body is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ServiceIpcFramingError("frame body must be a JSON object");
  }

  const msg = parsed as Record<string, unknown>;
  if (typeof msg.v !== "number") {
    throw new ServiceIpcFramingError("missing protocol version `v`");
  }
  if (typeof msg.id !== "string" || msg.id.length === 0) {
    throw new ServiceIpcFramingError("missing message `id`");
  }
  if (msg.type !== "req" && msg.type !== "res" && msg.type !== "err") {
    throw new ServiceIpcFramingError(`invalid message type: ${String(msg.type)}`);
  }

  return parsed as ServiceIpcMessage;
}

export function assertProtocolVersion(v: number): void {
  if (v !== SERVICE_IPC_PROTOCOL_VERSION) {
    throw serviceIpcError({
      layer: "transport",
      code: "protocol_mismatch",
      message: `unsupported IPC protocol version ${v}; expected ${SERVICE_IPC_PROTOCOL_VERSION}`,
    });
  }
}
