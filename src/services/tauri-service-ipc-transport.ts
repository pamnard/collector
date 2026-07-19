/**
 * WebView-safe Collector service IPC transport (#239).
 *
 * Uses Tauri `invoke` → Rust Unix-socket proxy → local host framing.
 * Does **not** import Node `net`. Not the default UI client until #170.
 */

import { invoke } from "@tauri-apps/api/core";

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

export async function tauriServiceIpcHealth(): Promise<{
  ok: boolean;
  status: string;
  open: boolean;
  healthy: boolean;
}> {
  return (await tauriServiceIpcRequest("health")) as {
    ok: boolean;
    status: string;
    open: boolean;
    healthy: boolean;
  };
}
