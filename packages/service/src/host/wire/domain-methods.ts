/**
 * Domain IPC method names (#155+ / #330). Transport ping/health stay separate.
 *
 * Catalog is derived from host-wire port keys + watcher extras — not a hand
 * list. Handlers live in {@link createDomainIpcRequestHandler}.
 */

import {
  HOST_WIRE_PORT_METHODS,
  type HostWirePortMethod,
} from "./domain-port-wire.js";

/** Watcher RPC is host IPC but not part of `@collector/api` port keys (#164). */
export const WATCHER_IPC_METHODS = [
  "startVaultFilesystemWatcher",
  "stopVaultFilesystemWatcher",
  "isVaultFilesystemWatcherActive",
] as const;

export type WatcherIpcMethod = (typeof WATCHER_IPC_METHODS)[number];

export type DomainIpcMethod = HostWirePortMethod | WatcherIpcMethod;

const DOMAIN_IPC_METHOD_LIST: readonly DomainIpcMethod[] = [
  ...HOST_WIRE_PORT_METHODS,
  ...WATCHER_IPC_METHODS,
];

/** Identity map for wire method string literals (stable keys for call sites). */
export const DOMAIN_IPC_METHODS = Object.fromEntries(
  DOMAIN_IPC_METHOD_LIST.map((method) => [method, method]),
) as { [K in DomainIpcMethod]: K };

export type ServiceIpcCoreMethod = "ping" | "health";
export type ServiceIpcMethod = ServiceIpcCoreMethod | DomainIpcMethod | string;

export type DomainIpcHandler = (params?: unknown) => Promise<unknown>;
export type DomainIpcHandlerMap = Record<string, DomainIpcHandler>;
