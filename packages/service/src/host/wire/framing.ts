/**
 * Local host wire message framing + versioned envelopes (#152).
 * Wire format: 4-byte big-endian length + UTF-8 JSON body (no NDJSON).
 */

import type { CollectorApiError } from "@collector/api";
import { hostWireError } from "./errors.js";

export type { HostWireMethod } from "./domain-methods.js";

/** Bump only with a coordinated client/host change. */
export const SERVICE_HOST_PROTOCOL_VERSION = 1;

export interface ServiceHostHealthResult {
  ok: boolean;
  status: "healthy" | "unhealthy";
  open: boolean;
  healthy: boolean;
}

export interface HostWireRequest {
  v: typeof SERVICE_HOST_PROTOCOL_VERSION;
  id: string;
  type: "req";
  method: string;
  params?: unknown;
}

export interface HostWireResponse {
  v: typeof SERVICE_HOST_PROTOCOL_VERSION;
  id: string;
  type: "res";
  result: unknown;
}

export interface HostWireErrorResponse {
  v: typeof SERVICE_HOST_PROTOCOL_VERSION;
  id: string;
  type: "err";
  error: CollectorApiError;
}

/** Host→client push (e.g. vault index sync status) (#163). */
export interface HostWireEvent {
  v: typeof SERVICE_HOST_PROTOCOL_VERSION;
  id: string;
  type: "evt";
  event: string;
  payload: unknown;
}

export type HostWireMessage =
  | HostWireRequest
  | HostWireResponse
  | HostWireErrorResponse
  | HostWireEvent;

/** Well-known host→client event names. */
export const SERVICE_HOST_EVENTS = {
  vaultIndexSyncStatus: "vaultIndexSyncStatus",
  appSettings: "appSettings",
} as const;

const MAX_FRAME_BYTES = 1024 * 1024;

export class HostWireFramingError extends Error {
  readonly code = "framing" as const;

  constructor(message: string) {
    super(message);
    this.name = "HostWireFramingError";
  }
}

export function encodeHostWireFrame(message: HostWireMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_FRAME_BYTES) {
    throw new HostWireFramingError(
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
export class HostWireFrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): HostWireMessage[] {
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : chunk;
    const messages: HostWireMessage[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES) {
        throw new HostWireFramingError(
          `frame length ${length} exceeds max ${MAX_FRAME_BYTES}`,
        );
      }
      if (this.buffer.length < 4 + length) {
        break;
      }
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      messages.push(decodeHostWireBody(body));
    }

    return messages;
  }
}

function decodeHostWireBody(body: Buffer): HostWireMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new HostWireFramingError("frame body is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new HostWireFramingError("frame body must be a JSON object");
  }

  const msg = parsed as Record<string, unknown>;
  if (typeof msg.v !== "number") {
    throw new HostWireFramingError("missing protocol version `v`");
  }
  if (typeof msg.id !== "string" || msg.id.length === 0) {
    throw new HostWireFramingError("missing message `id`");
  }
  if (
    msg.type !== "req" &&
    msg.type !== "res" &&
    msg.type !== "err" &&
    msg.type !== "evt"
  ) {
    throw new HostWireFramingError(`invalid message type: ${String(msg.type)}`);
  }
  if (msg.type === "evt") {
    if (typeof msg.event !== "string" || msg.event.length === 0) {
      throw new HostWireFramingError("evt frame missing event name");
    }
  }

  return parsed as HostWireMessage;
}

export function assertHostWireProtocolVersion(v: number): void {
  if (v !== SERVICE_HOST_PROTOCOL_VERSION) {
    throw hostWireError({
      layer: "transport",
      code: "protocol_mismatch",
      message: `unsupported host wire protocol version ${v}; expected ${SERVICE_HOST_PROTOCOL_VERSION}`,
    });
  }
}
