import type {
  CollectorService,
  DashboardSnapshotPort,
  UiSessionThumbnailPaths,
} from "@collector/api";
import type {
  ServiceHostHealthResult,
  HostWireRequestOptions,
} from "@collector/service/wire";

/**
 * UI-only slices injected by the app / Node dialer (#368).
 * Not host wire I/O — snapshot I/O and abs thumbnail paths stay client-side.
 */
export interface CollectorHostClientOptions {
  snapshot?: DashboardSnapshotPort;
  thumbnails?: UiSessionThumbnailPaths;
}

/** Transport extras used by smokes/harnesses — not part of CollectorService. */
export interface CollectorHostTransportExtras {
  ping(options?: HostWireRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: HostWireRequestOptions): Promise<ServiceHostHealthResult>;
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
export type CollectorHostServiceClient = CollectorService &
  CollectorHostTransportExtras;
