import type {
  CollectorService,
  DashboardSnapshotPort,
  UiSessionThumbnailPaths,
} from "@collector/api";
import type {
  ServiceIpcHealthResult,
  ServiceIpcRequestOptions,
} from "@collector/service/ipc";

/**
 * UI-only slices injected by the app / Node dialer (#368).
 * Not host IPC — snapshot I/O and abs thumbnail paths stay client-side.
 */
export interface CollectorIpcClientOptions {
  snapshot?: DashboardSnapshotPort;
  thumbnails?: UiSessionThumbnailPaths;
}

/** Transport extras used by smokes/harnesses — not part of CollectorService. */
export interface CollectorIpcTransportExtras {
  ping(options?: ServiceIpcRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: ServiceIpcRequestOptions): Promise<ServiceIpcHealthResult>;
  close(): Promise<void>;
  /** Host watcher orchestration (#164) — not part of the domain ports. */
  startVaultFilesystemWatcher(
    vaultId: string,
    vaultPath: string,
  ): Promise<void>;
  stopVaultFilesystemWatcher(): Promise<void>;
  isVaultFilesystemWatcherActive(): Promise<boolean>;
}

/** Domain ports + transport health helpers (#369). Primary for CLI/MCP. */
export type CollectorIpcServiceClient = CollectorService &
  CollectorIpcTransportExtras;
