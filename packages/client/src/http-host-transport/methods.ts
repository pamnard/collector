/**
 * HTTP domain methods for the host transport (#673).
 * Grouped by endpoint concern so new RPC/ping/health calls stay navigable.
 */

import type { CollectorApiError } from "@collector/api";
import type {
  HostWireRequestOptions,
  ServiceHostHealthResult,
} from "@collector/service/wire";
import { hostWireError } from "@collector/service/wire";
import { nextId, withTimeout } from "./shared.js";
import type { CollectorHostTransport, HttpMethodContext } from "./types.js";

function runTimed<T>(
  ctx: HttpMethodContext,
  label: string,
  requestOptions: HostWireRequestOptions | undefined,
  run: () => Promise<T>,
): Promise<T> {
  ctx.assertOpen();
  const timeoutMs = requestOptions?.timeoutMs ?? ctx.defaultRequestTimeoutMs;
  return withTimeout(run(), timeoutMs, label, requestOptions?.signal);
}

function buildRpcRequestMethod(
  ctx: HttpMethodContext,
): CollectorHostTransport["request"] {
  const { baseUrl, bearer } = ctx;
  return async (method, params, requestOptions) =>
    runTimed(ctx, `RPC ${method}`, requestOptions, async () => {
      const response = await fetch(`${baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: bearer,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: nextId(), method, params }),
        signal: requestOptions?.signal,
      });
      if (response.status === 401) {
        throw hostWireError({
          layer: "auth",
          code: "auth_failed",
          message: "Bearer authentication failed",
        });
      }
      if (!response.ok) {
        throw hostWireError({
          layer: "transport",
          code: "disconnected",
          message: `RPC HTTP ${response.status}`,
        });
      }
      const body = (await response.json()) as {
        id?: unknown;
        result?: unknown;
        error?: CollectorApiError;
      };
      if (body.error) {
        throw hostWireError(body.error);
      }
      return body.result;
    });
}

function buildPingMethod(
  ctx: HttpMethodContext,
): CollectorHostTransport["ping"] {
  const { baseUrl } = ctx;
  return async (requestOptions) =>
    runTimed(ctx, "ping", requestOptions, async () => {
      const response = await fetch(`${baseUrl}/ping`, {
        signal: requestOptions?.signal,
      });
      if (!response.ok) {
        throw hostWireError({
          layer: "transport",
          code: "disconnected",
          message: `ping HTTP ${response.status}`,
        });
      }
      const body = (await response.json()) as { ok?: boolean; pong?: boolean };
      if (!body.pong) {
        throw hostWireError({
          layer: "transport",
          code: "framing",
          message: "invalid ping response",
        });
      }
      return { ok: true as const, pong: true as const };
    });
}

function buildHealthMethod(
  ctx: HttpMethodContext,
): CollectorHostTransport["health"] {
  const { baseUrl, bearer } = ctx;
  return async (requestOptions) =>
    runTimed(ctx, "health", requestOptions, async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: bearer },
        signal: requestOptions?.signal,
      });
      if (response.status === 401) {
        throw hostWireError({
          layer: "auth",
          code: "auth_failed",
          message: "Bearer authentication failed",
        });
      }
      if (!response.ok && response.status !== 503) {
        throw hostWireError({
          layer: "transport",
          code: "disconnected",
          message: `health HTTP ${response.status}`,
        });
      }
      return (await response.json()) as ServiceHostHealthResult;
    });
}

export function buildHttpMethods(args: {
  baseUrl: string;
  token: string;
  defaultRequestTimeoutMs: number | undefined;
  isClosed: () => boolean;
}): Pick<CollectorHostTransport, "request" | "ping" | "health"> {
  const { baseUrl, token, defaultRequestTimeoutMs, isClosed } = args;
  const ctx: HttpMethodContext = {
    baseUrl,
    bearer: `Bearer ${token}`,
    defaultRequestTimeoutMs,
    assertOpen: () => {
      if (isClosed()) {
        throw hostWireError({
          layer: "transport",
          code: "not_connected",
          message: "HTTP host transport is closed",
        });
      }
    },
  };

  return {
    request: buildRpcRequestMethod(ctx),
    ping: buildPingMethod(ctx),
    health: buildHealthMethod(ctx),
  };
}
