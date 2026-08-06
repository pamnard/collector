/**
 * Node-only service host / wire surface.
 * Do not import from the app Vite bundle — use `@collector/service` for in-process UI.
 */

export {
  startServiceHost,
  formatServiceHostReadyLine,
  SERVICE_HOST_READY_PREFIX,
  type ServiceHost,
  type ServiceHostOptions,
} from "./host/service-host.js";

export { NodeSqliteExecutor } from "./host/node-sql.js";

export {
  SERVICE_HOST_PROTOCOL_VERSION,
  SERVICE_HOST_EVENTS,
  HostWireFrameReader,
  HostWireFramingError,
  encodeHostWireFrame,
  assertHostWireProtocolVersion,
  type ServiceHostHealthResult,
  type HostWireMessage,
  type HostWireMethod,
  type HostWireRequest,
  type HostWireResponse,
  type HostWireErrorResponse,
  type HostWireEvent,
} from "./host/wire/framing.js";

export {
  defaultHostWirePath,
  isWindowsNamedPipePath,
} from "./host/wire/paths.js";

export {
  SERVICE_HOST_AUTH_METHOD,
  SERVICE_HOST_TOKEN_ENV,
  SERVICE_HOST_TOKEN_FILENAME,
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  readServiceHostTokenFile,
  removeServiceHostTokenFile,
  resolveServiceHostToken,
  siblingServiceHostTokenPath,
  writeServiceHostTokenFile,
} from "./host/wire/auth.js";

export {
  startHostWireServer,
  type HostWireHandler,
  type HostWireServer,
} from "./host/wire/server.js";

export {
  connectHostWire,
  type HostWireClient,
  type HostWireClientOptions,
  type HostWireRequestOptions,
} from "./host/wire/client.js";

export type {
  HostWireClient as HostWireTransport,
} from "./host/wire/transport-types.js";

export {
  HostWireError,
  getCollectorApiError,
  isHostWireError,
  mapHandlerThrownToApiError,
  mapNodeConnectErrno,
  hostWireError,
} from "./host/wire/errors.js";

export {
  DOMAIN_WIRE_METHODS,
  WATCHER_WIRE_METHODS,
  type DomainWireHandler,
  type DomainWireHandlerMap,
  type DomainWireMethod,
  type WatcherWireMethod,
} from "./host/wire/domain-methods.js";

export {
  ALL_PORT_METHOD_KEYS,
  assertHostPortWireCoverage,
  CLIENT_ORCHESTRATED_PORT_METHODS,
  HOST_WIRE_PORT_METHODS,
  type ClientOrchestratedPortMethod,
  type HostWirePortMethod,
} from "./host/wire/domain-port-wire.js";

export {
  createDomainWireDispatcher,
  createDomainWireRequestHandler,
  DOMAIN_DISPATCH_REGISTRY,
} from "./host/wire/domain-dispatch.js";

export {
  createServiceDomainRuntime,
  type ServiceDomainRuntime,
  type ServiceDomainRuntimeOptions,
} from "./host/domain-runtime.js";

/** Sync plugin wake controller (#31) — also on service barrel; host uses runtime.syncPluginWake. */
export {
  createSyncPluginWakeController,
  type SyncPluginWakeController,
  type SyncPluginWakeControllerDeps,
  type SyncPluginWakePolicy,
} from "./sync-plugin-wake.js";

/** OS keychain credentials (#30) — Node/host only; never `@collector/service` barrel. */
export {
  CREDENTIALS_KEYCHAIN_SERVICE,
  createCredentialsService,
  createMemoryKeychainBackend,
  createOsKeychainBackend,
  createUnavailableKeychainBackend,
  credentialAccount,
  type CredentialsServiceDeps,
  type KeychainBackend,
} from "./credentials.js";

