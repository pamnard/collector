import type { ActiveVaultResult } from "./items.js";

/** Boot / DB port (#361). */
export interface BootPort {
  openCollectorDatabase(): Promise<void>;
  ensureCollectorDatabaseHealthy(): Promise<void>;
  ensureActiveVault(): Promise<ActiveVaultResult>;
  getDataDirectory(): Promise<string>;
}
