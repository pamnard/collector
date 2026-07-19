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
  type DomainIpcHandler,
  type DomainIpcHandlerMap,
  type DomainIpcMethod,
} from "./host/ipc/domain-methods.js";

export {
  buildDomainIpcHandlers,
  createDomainIpcDispatcher,
} from "./host/ipc/domain-handlers.js";

export {
  createServiceDomainRuntime,
  type ServiceDomainRuntime,
} from "./host/domain-runtime.js";
