import type {
  CollectorService,
  DashboardSnapshotPort,
} from "@collector/api";
import type { ServiceIpcClient } from "@collector/service/ipc";
import type {
  CollectorIpcClientOptions,
  CollectorIpcTransportExtras,
} from "./ipc-client-types.js";
import { createIpcSessionCtx } from "./ipc-session-ctx.js";
import { createMemoryDashboardSnapshotPort } from "./memory-dashboard-snapshot-port.js";
import { createIpcTransportExtras } from "./transport-extras.js";
import { createIpcBootPort } from "./ipc-ports/boot.js";
import { createIpcItemsPort } from "./ipc-ports/items.js";
import { createIpcTagsPort } from "./ipc-ports/tags.js";
import { createIpcFoldersPort } from "./ipc-ports/folders.js";
import { createIpcMediaPort } from "./ipc-ports/media.js";
import { createIpcVaultsPort } from "./ipc-ports/vaults.js";
import { createIpcIndexPort } from "./ipc-ports/index.js";
import { createIpcSettingsPort } from "./ipc-ports/settings.js";

export type IpcBacking = {
  service: CollectorService;
  snapshot: DashboardSnapshotPort;
  extras: CollectorIpcTransportExtras;
};

/**
 * Shared transport session: one cache set for ports + snapshot + extras (#366 / #368 / #383).
 */
export function createIpcBacking(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): IpcBacking {
  const ctx = createIpcSessionCtx(transport, options);
  const extras = createIpcTransportExtras(transport);
  const service: CollectorService = {
    boot: createIpcBootPort(ctx),
    items: createIpcItemsPort(ctx),
    tags: createIpcTagsPort(ctx),
    folders: createIpcFoldersPort(ctx),
    media: createIpcMediaPort(ctx),
    vaults: createIpcVaultsPort(ctx),
    index: createIpcIndexPort(ctx),
    settings: createIpcSettingsPort(ctx),
  };
  const snapshot = options.snapshot ?? createMemoryDashboardSnapshotPort();
  return { service, snapshot, extras };
}
