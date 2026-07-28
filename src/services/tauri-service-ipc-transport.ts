/**
 * WebView-safe Collector service IPC transport (#239/#240/#329).
 *
 * Uses Tauri `invoke` → Rust Unix-socket proxy → local host framing.
 * Implements {@link ServiceIpcClient} for {@link createIpcAdapter}.
 * Host→client push: Rust demux emits `service-ipc-event`; this transport
 * listens and fans out via {@link ServiceIpcClient.onEvent}.
 * Does **not** import Node `net`.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ServiceIpcClient,
  ServiceIpcHealthResult,
  ServiceIpcRequestOptions,
} from "@collector/service/ipc";
import { serviceIpcError } from "@collector/service/ipc";

/** Must match `SERVICE_IPC_EVENT` in `src-tauri/src/service_ipc.rs`. */
export const TAURI_SERVICE_IPC_EVENT = "service-ipc-event";

export type TauriServiceIpcEventPayload = {
  event: string;
  payload: unknown;
};

export async function tauriServiceIpcConnect(ipcPath: string): Promise<string> {
  return invoke<string>("service_ipc_connect", { ipcPath });
}

export async function tauriServiceIpcRequest(
  method: string,
  params?: unknown,
): Promise<unknown> {
  return invoke("service_ipc_request", {
    method,
    params: params ?? null,
  });
}

export async function tauriServiceIpcDisconnect(): Promise<void> {
  await invoke("service_ipc_disconnect");
}

export async function tauriServiceIpcPing(): Promise<{ ok: true; pong: true }> {
  return (await tauriServiceIpcRequest("ping")) as { ok: true; pong: true };
}

export async function tauriServiceIpcHealth(): Promise<ServiceIpcHealthResult> {
  return (await tauriServiceIpcRequest("health")) as ServiceIpcHealthResult;
}

async function requestWithOptions(
  method: string,
  params: unknown | undefined,
  options?: ServiceIpcRequestOptions,
): Promise<unknown> {
  if (options?.signal?.aborted) {
    throw serviceIpcError({
      layer: "transport",
      code: "cancelled",
      message: `IPC request cancelled (${method})`,
    });
  }

  const run = tauriServiceIpcRequest(method, params);
  if (options?.timeoutMs === undefined && !options?.signal) {
    return run;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer =
      options?.timeoutMs === undefined
        ? null
        : setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(
              serviceIpcError({
                layer: "transport",
                code: "timeout",
                message: `IPC request timed out after ${options.timeoutMs}ms (${method})`,
              }),
            );
          }, options.timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(
        serviceIpcError({
          layer: "transport",
          code: "cancelled",
          message: `IPC request cancelled (${method})`,
        }),
      );
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    run.then(
      (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
        reject(error);
      },
    );
  });
}

/**
 * Connect via Tauri proxy and return a {@link ServiceIpcClient} for the UI.
 * Host push events are forwarded through {@link TAURI_SERVICE_IPC_EVENT} (#329).
 */
export async function createTauriServiceIpcTransport(
  ipcPath: string,
): Promise<ServiceIpcClient> {
  await tauriServiceIpcConnect(ipcPath);

  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  let unlisten: UnlistenFn | null = null;
  let listenFailed = false;

  const ensureListen = async (): Promise<void> => {
    if (unlisten || listenFailed) {
      return;
    }
    try {
      unlisten = await listen<TauriServiceIpcEventPayload>(
        TAURI_SERVICE_IPC_EVENT,
        (event) => {
          const body = event.payload;
          if (!body || typeof body.event !== "string") {
            return;
          }
          const set = handlers.get(body.event);
          if (!set) {
            return;
          }
          for (const handler of set) {
            handler(body.payload);
          }
        },
      );
    } catch {
      listenFailed = true;
    }
  };

  return {
    request: (method, params, options) =>
      requestWithOptions(method, params, options),
    ping: async (options) =>
      (await requestWithOptions("ping", undefined, options)) as {
        ok: true;
        pong: true;
      },
    health: async (options) =>
      (await requestWithOptions("health", undefined, options)) as ServiceIpcHealthResult,
    onEvent(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      void ensureListen();
      return () => {
        set!.delete(handler);
        if (set!.size === 0) {
          handlers.delete(event);
        }
      };
    },
    close: async () => {
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      handlers.clear();
      await tauriServiceIpcDisconnect();
    },
  };
}
