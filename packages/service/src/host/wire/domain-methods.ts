/**
 * Domain IPC method names (#155+ / #330). Transport ping/health stay separate.
 *
 * Catalog is derived from host-wire port keys + watcher extras — not a hand
 * list. Handlers live in {@link createDomainWireRequestHandler}.
 */

import {
  HOST_WIRE_PORT_METHODS,
  type HostWirePortMethod,
} from "./domain-port-wire.js";

/** Watcher RPC is host IPC but not part of `@collector/api` port keys (#164). */
export const WATCHER_WIRE_METHODS = [
  "startVaultFilesystemWatcher",
  "stopVaultFilesystemWatcher",
  "isVaultFilesystemWatcherActive",
] as const;

export type WatcherWireMethod = (typeof WATCHER_WIRE_METHODS)[number];

export type DomainWireMethod = HostWirePortMethod | WatcherWireMethod;

const DOMAIN_WIRE_METHOD_LIST: readonly DomainWireMethod[] = [
  ...HOST_WIRE_PORT_METHODS,
  ...WATCHER_WIRE_METHODS,
];

/** Identity map for wire method string literals (stable keys for call sites). */
export const DOMAIN_WIRE_METHODS = Object.fromEntries(
  DOMAIN_WIRE_METHOD_LIST.map((method) => [method, method]),
) as { [K in DomainWireMethod]: K };

export type HostWireCoreMethod = "ping" | "health";
export type HostWireMethod = HostWireCoreMethod | DomainWireMethod | string;

export type DomainWireHandler = (params?: unknown) => Promise<unknown>;
export type DomainWireHandlerMap = Record<string, DomainWireHandler>;
