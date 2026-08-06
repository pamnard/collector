import type {
  CollectorService,
  DashboardSnapshotPort,
} from "@collector/api";
import type { HostWireClient } from "@collector/service/wire";
import type {
  CollectorHostClientOptions,
  CollectorHostTransportExtras,
} from "./host-client-types.js";
import { createHostSessionCtx } from "./host-session-ctx.js";
import { createMemoryDashboardSnapshotPort } from "./memory-dashboard-snapshot-port.js";
import { createHostTransportExtras } from "./transport-extras.js";
import { createHostBootPort } from "./host-ports/boot.js";
import { createHostItemsPort } from "./host-ports/items.js";
import { createHostTagsPort } from "./host-ports/tags.js";
import { createHostFoldersPort } from "./host-ports/folders.js";
import { createHostMediaPort } from "./host-ports/media.js";
import { createHostVaultsPort } from "./host-ports/vaults.js";
import { createHostIndexPort } from "./host-ports/index.js";
import { createHostSettingsPort } from "./host-ports/settings.js";
import { createHostCredentialsPort } from "./host-ports/credentials.js";
import { createHostSyncPluginsPort } from "./host-ports/sync-plugins.js";
import { createHostTelegramSyncPort } from "./host-ports/telegram-sync.js";

export type HostBacking = {
  service: CollectorService;
  snapshot: DashboardSnapshotPort;
  extras: CollectorHostTransportExtras;
};

/**
 * Shared transport session: one cache set for ports + snapshot + extras (#366 / #368 / #383).
 */
export function createHostBacking(
  transport: HostWireClient,
  options: CollectorHostClientOptions = {},
): HostBacking {
  const ctx = createHostSessionCtx(transport, options);
  const extras = createHostTransportExtras(transport);
  const service: CollectorService = {
    boot: createHostBootPort(ctx),
    items: createHostItemsPort(ctx),
    tags: createHostTagsPort(ctx),
    folders: createHostFoldersPort(ctx),
    media: createHostMediaPort(ctx),
    vaults: createHostVaultsPort(ctx),
    index: createHostIndexPort(ctx),
    settings: createHostSettingsPort(ctx),
    credentials: createHostCredentialsPort(ctx),
    syncPlugins: createHostSyncPluginsPort(ctx),
    telegramSync: createHostTelegramSyncPort(ctx),
  };
  const snapshot = options.snapshot ?? createMemoryDashboardSnapshotPort();
  return { service, snapshot, extras };
}
