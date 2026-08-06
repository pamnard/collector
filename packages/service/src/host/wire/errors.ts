/**
 * IPC failure → `@collector/api` error mapping (#153).
 *
 * | Failure mode                         | layer       | code               |
 * | ------------------------------------ | ----------- | ------------------ |
 * | Connect refused / missing endpoint   | transport   | not_connected      |
 * | Connect timeout                      | transport   | timeout            |
 * | Per-request timeout                  | transport   | timeout            |
 * | AbortSignal / explicit cancel        | transport   | cancelled          |
 * | Peer closed / destroy mid-request    | transport   | disconnected       |
 * | Client already closed / not dialed   | transport   | not_connected      |
 * | Length/JSON framing failure          | transport   | framing            |
 * | Unsupported protocol `v`             | transport   | protocol_mismatch  |
 * | Missing handshake token (client)     | auth        | token_missing      |
 * | Peer skipped / failed `auth`         | auth        | auth_required / auth_failed |
 * | Unknown method / bad req shape       | validation  | unknown_method / bad_request |
 * | Handler throws `CollectorApiError`   | (as thrown) | (as thrown)        |
 * | Handler throws other Error           | domain      | failed             |
 *
 * Clients always reject with {@link HostWireError} so callers can read
 * `.collectorError` without scraping message strings.
 */

import type { CollectorApiError } from "@collector/api";

export class HostWireError extends Error {
  readonly collectorError: CollectorApiError;
  readonly layer: CollectorApiError["layer"];
  readonly code: CollectorApiError["code"];

  constructor(error: CollectorApiError) {
    super(error.message);
    this.name = "HostWireError";
    this.collectorError = error;
    this.layer = error.layer;
    this.code = error.code;
  }
}

export function isHostWireError(error: unknown): error is HostWireError {
  return error instanceof HostWireError;
}

export function getCollectorApiError(
  error: unknown,
): CollectorApiError | null {
  if (isHostWireError(error)) {
    return error.collectorError;
  }
  if (
    error &&
    typeof error === "object" &&
    "collectorError" in error &&
    (error as { collectorError: unknown }).collectorError &&
    typeof (error as { collectorError: CollectorApiError }).collectorError ===
      "object" &&
    "layer" in (error as { collectorError: CollectorApiError }).collectorError &&
    "message" in (error as { collectorError: CollectorApiError }).collectorError
  ) {
    return (error as { collectorError: CollectorApiError }).collectorError;
  }
  return null;
}

export function hostWireError(error: CollectorApiError): HostWireError {
  return new HostWireError(error);
}

/** Map a Node connect/socket errno into a stable transport error. */
export function mapNodeConnectErrno(
  error: NodeJS.ErrnoException,
  phase: "connect" | "socket",
): HostWireError {
  const code = error.code;
  if (phase === "connect") {
    if (code === "ENOENT" || code === "ECONNREFUSED" || code === "EADDRNOTAVAIL") {
      return hostWireError({
        layer: "transport",
        code: "not_connected",
        message: `IPC connect failed: ${code ?? error.message}`,
      });
    }
    if (code === "ETIMEDOUT") {
      return hostWireError({
        layer: "transport",
        code: "timeout",
        message: `IPC connect timed out: ${error.message}`,
      });
    }
    return hostWireError({
      layer: "transport",
      code: "not_connected",
      message: `IPC connect failed: ${error.message}`,
    });
  }

  if (code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
    return hostWireError({
      layer: "transport",
      code: "disconnected",
      message: `IPC socket error: ${code ?? error.message}`,
    });
  }

  return hostWireError({
    layer: "transport",
    code: "disconnected",
    message: `IPC socket error: ${error.message}`,
  });
}

/** Normalize any thrown value from a handler into a wire `CollectorApiError`. */
export function mapHandlerThrownToApiError(error: unknown): CollectorApiError {
  const existing = getCollectorApiError(error);
  if (existing) {
    return existing;
  }
  return {
    layer: "domain",
    code: "failed",
    message: error instanceof Error ? error.message : String(error),
  };
}
