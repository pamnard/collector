/**
 * HTTP RPC method builders for {@link createHttpHostTransport} (#715).
 * One helper per transport surface so adding a call stays navigable.
 */

import type { CollectorApiError } from "@collector/api";
import {
  hostWireError,
  type HostWireClient,
  type HostWireRequestOptions,
  type ServiceHostHealthResult,
} from "@collector/service/wire";

export type HttpMethodsArgs = {
  baseUrl: string;
  token: string;
  defaultRequestTimeoutMs: number | undefined;
  isClosed: () => boolean;
};

type HttpMethodsCtx = {
  baseUrl: string;
  bearer: string;
  defaultRequestTimeoutMs: number | undefined;
  assertOpen: () => void;
};

function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cancelledError(label: string): Error {
  return hostWireError({
    layer: "transport",
    code: "cancelled",
    message: `${label} cancelled`,
  });
}

function resolveTimeoutMs(
  ctx: HttpMethodsCtx,
  requestOptions?: HostWireRequestOptions,
): number | undefined {
  return requestOptions?.timeoutMs ?? ctx.defaultRequestTimeoutMs;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(cancelledError(label));
  }
  if (timeoutMs === undefined) {
    if (!signal) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(cancelledError(label));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        hostWireError({
          layer: "transport",
          code: "timeout",
          message: `${label} timed out after ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cancelledError(label));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function createHttpRequest(ctx: HttpMethodsCtx): HostWireClient["request"] {
  return async (method, params, requestOptions) => {
    ctx.assertOpen();
    const run = (async () => {
      const response = await fetch(`${ctx.baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: ctx.bearer,
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
    })();
    return withTimeout(
      run,
      resolveTimeoutMs(ctx, requestOptions),
      `RPC ${method}`,
      requestOptions?.signal,
    );
  };
}

function createHttpPing(ctx: HttpMethodsCtx): HostWireClient["ping"] {
  return async (requestOptions) => {
    ctx.assertOpen();
    const run = (async () => {
      const response = await fetch(`${ctx.baseUrl}/ping`, {
        signal: requestOptions?.signal,
      });
      if (!response.ok) {
        throw hostWireError({
          layer: "transport",
          code: "disconnected",
          message: `ping HTTP ${response.status}`,
        });
      }
      const body = (await response.json()) as {
        ok?: boolean;
        pong?: boolean;
      };
      if (!body.pong) {
        throw hostWireError({
          layer: "transport",
          code: "framing",
          message: "invalid ping response",
        });
      }
      return { ok: true as const, pong: true as const };
    })();
    return withTimeout(
      run,
      resolveTimeoutMs(ctx, requestOptions),
      "ping",
      requestOptions?.signal,
    );
  };
}

function createHttpHealth(ctx: HttpMethodsCtx): HostWireClient["health"] {
  return async (requestOptions) => {
    ctx.assertOpen();
    const run = (async () => {
      const response = await fetch(`${ctx.baseUrl}/health`, {
        headers: { Authorization: ctx.bearer },
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
    })();
    return withTimeout(
      run,
      resolveTimeoutMs(ctx, requestOptions),
      "health",
      requestOptions?.signal,
    );
  };
}

export function buildHttpMethods(
  args: HttpMethodsArgs,
): Pick<HostWireClient, "request" | "ping" | "health"> {
  const assertOpen = (): void => {
    if (args.isClosed()) {
      throw hostWireError({
        layer: "transport",
        code: "not_connected",
        message: "HTTP host transport is closed",
      });
    }
  };
  const ctx: HttpMethodsCtx = {
    baseUrl: args.baseUrl,
    bearer: `Bearer ${args.token}`,
    defaultRequestTimeoutMs: args.defaultRequestTimeoutMs,
    assertOpen,
  };
  return {
    request: createHttpRequest(ctx),
    ping: createHttpPing(ctx),
    health: createHttpHealth(ctx),
  };
}

/** Shared by dial path in {@link createHttpHostTransport}. */
export async function dialHttpHealth(
  baseUrl: string,
  token: string,
  connectTimeoutMs: number,
): Promise<void> {
  const run = (async () => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw hostWireError({
        layer: "transport",
        code: "not_connected",
        message:
          error instanceof Error
            ? `HTTP health dial failed: ${error.message}`
            : "HTTP health dial failed",
      });
    }
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
        code: "not_connected",
        message: `HTTP health dial failed: HTTP ${response.status}`,
      });
    }
    await response.arrayBuffer();
  })();
  await withTimeout(run, connectTimeoutMs, "HTTP health dial");
}
