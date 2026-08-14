/**
 * Node-only service host / wire surface.
 * Do not import from the app Vite bundle — use `@collector/service` for in-process UI.
 */

export {
  startServiceHost,
  formatServiceHostReadyLine,
  SERVICE_HOST_READY_PREFIX,
  DEFAULT_SERVICE_HOST_PORT,
  resolveServiceHostListenPort,
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
  SERVICE_HOST_TOKEN_ENV,
  SERVICE_HOST_TOKEN_FILENAME,
  defaultServiceHostTokenPath,
  generateServiceHostToken,
  readServiceHostTokenFile,
  removeServiceHostTokenFile,
  resolveServiceHostToken,
  writeServiceHostTokenFile,
} from "./host/wire/auth.js";

export {
  SERVICE_HOST_BASE_URL_ENV,
  SERVICE_HOST_BASE_URL_FILENAME,
  defaultServiceHostBaseUrlPath,
  readServiceHostBaseUrlFile,
  removeServiceHostBaseUrlFile,
  resolveServiceHostBaseUrl,
  writeServiceHostBaseUrlFile,
  type ResolveServiceHostBaseUrlOptions,
} from "./host/wire/base-url.js";

export type {
  HostWireClient,
  HostWireClientOptions,
  HostWireRequestOptions,
} from "./host/wire/transport-types.js";

export {
  HostWireError,
  formatHostConnectFailure,
  getCollectorApiError,
  isHostWireError,
  mapHandlerThrownToApiError,
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

export {
  isValidBearer,
  isValidHostToken,
  extractBearerToken,
} from "./host/http/bearer.js";

export {
  createHostHttpEventsHub,
  HOST_HTTP_EVENTS,
  type HostHttpEventsHub,
  type HostHttpEventName,
} from "./host/http/events-hub.js";

export {
  handleHttpRpc,
  writeUnauthorized,
  type DomainDispatch,
  type HttpRpcBody,
} from "./host/http/rpc-handler.js";

export { writeJson } from "./host/http/write-json.js";

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

