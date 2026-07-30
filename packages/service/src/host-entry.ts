/**
 * Node-only service host / IPC surface.
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
  SERVICE_IPC_PROTOCOL_VERSION,
  SERVICE_IPC_EVENTS,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  encodeServiceIpcFrame,
  assertProtocolVersion,
  type ServiceIpcHealthResult,
  type ServiceIpcMessage,
  type ServiceIpcMethod,
  type ServiceIpcRequest,
  type ServiceIpcResponse,
  type ServiceIpcErrorResponse,
  type ServiceIpcEvent,
} from "./host/ipc/framing.js";

export {
  defaultServiceIpcPath,
  isWindowsNamedPipePath,
} from "./host/ipc/paths.js";

export {
  SERVICE_IPC_AUTH_METHOD,
  SERVICE_IPC_TOKEN_ENV,
  SERVICE_IPC_TOKEN_FILENAME,
  defaultServiceIpcTokenPath,
  generateServiceIpcToken,
  readServiceIpcTokenFile,
  removeServiceIpcTokenFile,
  resolveServiceIpcToken,
  siblingServiceIpcTokenPath,
  writeServiceIpcTokenFile,
} from "./host/ipc/auth.js";

export {
  startServiceIpcServer,
  type ServiceIpcHandler,
  type ServiceIpcServer,
} from "./host/ipc/server.js";

export {
  connectServiceIpc,
  type ServiceIpcClient,
  type ServiceIpcClientOptions,
  type ServiceIpcRequestOptions,
} from "./host/ipc/client.js";

export type {
  ServiceIpcClient as ServiceIpcTransport,
} from "./host/ipc/transport-types.js";

export {
  ServiceIpcError,
  getCollectorApiError,
  isServiceIpcError,
  mapHandlerThrownToApiError,
  mapNodeIpcErrno,
  serviceIpcError,
} from "./host/ipc/errors.js";

export {
  DOMAIN_IPC_METHODS,
  WATCHER_IPC_METHODS,
  type DomainIpcHandler,
  type DomainIpcHandlerMap,
  type DomainIpcMethod,
  type WatcherIpcMethod,
} from "./host/ipc/domain-methods.js";

export {
  ALL_PORT_METHOD_KEYS,
  assertHostPortWireCoverage,
  CLIENT_ORCHESTRATED_PORT_METHODS,
  HOST_WIRE_PORT_METHODS,
  type ClientOrchestratedPortMethod,
  type HostWirePortMethod,
} from "./host/ipc/domain-port-wire.js";

export {
  createDomainIpcDispatcher,
  createDomainIpcRequestHandler,
  DOMAIN_DISPATCH_REGISTRY,
} from "./host/ipc/domain-dispatch.js";

export {
  createServiceDomainRuntime,
  type ServiceDomainRuntime,
} from "./host/domain-runtime.js";
