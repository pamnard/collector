/**
 * WebView-safe Collector service host wire transport via Tauri (#239/#240/#329).
 *
 * Uses Tauri `invoke` → Rust Unix-socket proxy → local host framing.
 * Implements {@link HostWireClient} for {@link createTauriDesktopCollectorService}.
 * Host→client push: Rust demux emits `service-ipc-event`; this transport
 * listens and fans out via {@link HostWireClient.onEvent}.
 * Does **not** import Node `net`.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  HostWireClient,
  ServiceHostHealthResult,
  HostWireRequestOptions,
} from "@collector/service/wire";
import { hostWireError } from "@collector/service/wire";

/** Must match `SERVICE_IPC_EVENT` in `src-tauri/src/service_ipc.rs`. */
export const TAURI_HOST_WIRE_EVENT = "service-ipc-event";

export type TauriHostWireEventPayload = {
  event: string;
  payload: unknown;
};

export async function tauriHostWireConnect(
  socketPath: string,
  dataDir: string,
): Promise<string> {
  return invoke<string>("service_ipc_connect", { ipcPath: socketPath, dataDir });
}

export async function tauriHostWireRequest(
  method: string,
  params?: unknown,
): Promise<unknown> {
  return invoke("service_ipc_request", {
    method,
    params: params ?? null,
  });
}

export async function tauriHostWireDisconnect(): Promise<void> {
  await invoke("service_ipc_disconnect");
}

export async function tauriHostWirePing(): Promise<{ ok: true; pong: true }> {
  return (await tauriHostWireRequest("ping")) as { ok: true; pong: true };
}

export async function tauriHostWireHealth(): Promise<ServiceHostHealthResult> {
  return (await tauriHostWireRequest("health")) as ServiceHostHealthResult;
}

async function requestWithOptions(
  method: string,
  params: unknown | undefined,
  options?: HostWireRequestOptions,
): Promise<unknown> {
  if (options?.signal?.aborted) {
    throw hostWireError({
      layer: "transport",
      code: "cancelled",
      message: `host wire request cancelled (${method})`,
    });
  }

  const run = tauriHostWireRequest(method, params);
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
              hostWireError({
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
        hostWireError({
          layer: "transport",
          code: "cancelled",
          message: `host wire request cancelled (${method})`,
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
 * Connect via Tauri proxy and return a {@link HostWireClient} for the UI.
 * Host push events are forwarded through {@link TAURI_HOST_WIRE_EVENT} (#329).
 */
export async function createTauriHostWireTransport(
  socketPath: string,
  dataDir: string,
): Promise<HostWireClient> {
  await tauriHostWireConnect(socketPath, dataDir);

  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  let unlisten: UnlistenFn | null = null;
  let listenFailed = false;

  const ensureListen = async (): Promise<void> => {
    if (unlisten || listenFailed) {
      return;
    }
    try {
      unlisten = await listen<TauriHostWireEventPayload>(
        TAURI_HOST_WIRE_EVENT,
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
      (await requestWithOptions("health", undefined, options)) as ServiceHostHealthResult,
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
      await tauriHostWireDisconnect();
    },
  };
}
