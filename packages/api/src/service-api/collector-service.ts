import type { BootPort } from "./boot.js";
import type { CredentialsPort } from "./credentials.js";
import type { ExtractPort } from "./extract.js";
import type { FoldersPort } from "./folders.js";
import type { IndexPort } from "./index-port.js";
import type { ItemsPort } from "./items.js";
import type { JobsPort } from "./jobs.js";
import type { MediaPort } from "./media.js";
import type { SettingsPort } from "./settings.js";
import type { SyncPluginsPort } from "./sync-plugins.js";
import type { TagsPort } from "./tags.js";
import type { TelegramSyncPort } from "./telegram-sync.js";
import type { VaultsPort } from "./vaults.js";

/**
 * Port-segmented sole-writer service contract (#361 / #360).
 * UI takes the composite (+ {@link UiSession} for UI-only slices); CLI/MCP take
 * only the ports they need.
 */
export interface CollectorService {
  boot: BootPort;
  items: ItemsPort;
  tags: TagsPort;
  folders: FoldersPort;
  media: MediaPort;
  vaults: VaultsPort;
  index: IndexPort;
  settings: SettingsPort;
  credentials: CredentialsPort;
  syncPlugins: SyncPluginsPort;
  /** Discover → extract host surface (#849). */
  extract: ExtractPort;
  /** Telegram Path C settings (#415). */
  telegramSync: TelegramSyncPort;
  /** Background job queue observability (#630). */
  jobs: JobsPort;
}
