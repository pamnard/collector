/**
 * Vault list/switch/default/ensure (#150).
 * Host injects index boot, watcher stop, settings/snapshot side effects.
 */

import type { AppSettings, ItemFile, VaultMeta } from "@collector/shared";
import {
  assertVaultTreeLayout,
  createSingleFlight,
  createVault,
  readVaultMeta,
  runEmptyVaultBootstrap,
  upsertItem,
  vaultMetaPath,
  vaultRoot,
  vaultsRoot,
  writeVaultMeta,
  type VaultContext,
} from "@collector/core";

export type VaultEntry = { meta: VaultMeta; path: string };

/** Vault dirs are UUID folders only — skip backups / stray names under vaults/. */
const VAULT_DIR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VaultsServiceDeps {
  ensureInitialized: () => Promise<void>;
  getDataDir: () => string;
  getContext: () => VaultContext;
  ensureAppSettings: () => Promise<AppSettings>;
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  clearDashboardSnapshot: () => Promise<void>;
  stopVaultFilesystemWatcher: () => Promise<void>;
  /** Cleared on switch so watcher can start again for the new vault. */
  enableVaultWatcher: (vaultId: string) => void;
  nowIso?: () => string;
  createWelcomeItem?: (vaultId: string) => {
    item: ItemFile;
    content: string;
  };
}

export interface VaultsService {
  listVaultEntries(): Promise<VaultEntry[]>;
  listVaults(): Promise<VaultMeta[]>;
  getActiveVaultMeta(): Promise<VaultMeta>;
  switchVault(vaultId: string): Promise<VaultMeta>;
  setDefaultVault(vaultId: string): Promise<void>;
  resolveActiveVault(): Promise<{ vault: VaultMeta; path: string }>;
  ensureActiveVault(): Promise<{ vault: VaultMeta; path: string }>;
  getActiveVaultEntry(): VaultEntry | null;
  clearActiveVault(): void;
}

function pickVaultEntry(
  entries: VaultEntry[],
  preferredId: string | null,
): VaultEntry | null {
  if (preferredId) {
    const stored = entries.find((entry) => entry.meta.id === preferredId);
    if (stored) {
      return stored;
    }
  }

  const defaultVault = entries.find((entry) => entry.meta.is_default);
  if (defaultVault) {
    return defaultVault;
  }

  return entries[0] ?? null;
}

function defaultWelcomeItem(vaultId: string): { item: ItemFile; content: string } {
  const now = new Date().toISOString();
  return {
    item: {
      id: `${crypto.randomUUID()}.md`,
      vault_id: vaultId,
      title: "Welcome to Collector",
      description:
        "First offline item stored on disk and indexed in SQLite.",
      content_type: "note",
      source_type: "manual",
      metadata: {},
      tag_ids: [],
      collection_ids: [],
      folder_path: "",
      content_revision: 1,
      created_at: now,
      updated_at: now,
    },
    content: "# Collector\n\nOffline vault is working.",
  };
}

export function createVaultsService(deps: VaultsServiceDeps): VaultsService {
  let activeVault: VaultEntry | null = null;

  const listVaultEntries = async (): Promise<VaultEntry[]> => {
    await deps.ensureInitialized();
    const root = vaultsRoot(deps.getDataDir());
    const fs = deps.getContext().fs;
    if (!(await fs.exists(root))) {
      return [];
    }

    const entries: VaultEntry[] = [];
    for (const vaultId of await fs.readDir(root)) {
      if (!VAULT_DIR_ID_RE.test(vaultId)) {
        continue;
      }
      const path = vaultRoot(root, vaultId);
      if (await fs.exists(vaultMetaPath(path))) {
        // Do not assert layout here: orphan/legacy neighbors must not block listing
        // or opening a healthy active vault. Assert only when selecting a vault.
        const meta = await readVaultMeta(fs, path);
        entries.push({ meta, path });
      }
    }

    return entries.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  };

  const resolveActiveVaultShared = createSingleFlight(async () => {
    if (activeVault) {
      return { vault: activeVault.meta, path: activeVault.path };
    }

    const ctx = deps.getContext();
    const root = vaultsRoot(deps.getDataDir());
    await ctx.fs.mkdir(root);

    const settings = await deps.ensureAppSettings();
    const storedVaultId = settings.active_vault_id ?? null;
    const existing = await listVaultEntries();
    const selected = pickVaultEntry(existing, storedVaultId);

    let meta: VaultMeta | null = selected?.meta ?? null;
    let vaultPath = selected?.path ?? "";

    if (!meta) {
      const bootstrapped = await runEmptyVaultBootstrap(ctx.fs, root, {
        tryResolveExisting: async () => {
          const existingAfterLock = await listVaultEntries();
          const selectedAfterLock = pickVaultEntry(
            existingAfterLock,
            storedVaultId,
          );
          if (!selectedAfterLock) {
            return null;
          }
          await assertVaultTreeLayout(ctx.fs, selectedAfterLock.path);
          return {
            meta: selectedAfterLock.meta,
            path: selectedAfterLock.path,
          };
        },
        create: async () => {
          const created = await createVault(ctx, deps.getDataDir(), {
            name: "Default Vault",
            isDefault: true,
          });

          const welcome =
            deps.createWelcomeItem?.(created.meta.id) ??
            defaultWelcomeItem(created.meta.id);

          await upsertItem(ctx, created.path, created.meta.id, welcome);

          await deps.updateAppSettings({ active_vault_id: created.meta.id });
          return { meta: created.meta, path: created.path };
        },
      });
      meta = bootstrapped.meta;
      vaultPath = bootstrapped.path;
    } else {
      await assertVaultTreeLayout(ctx.fs, vaultPath);
    }

    activeVault = { meta, path: vaultPath };
    return { vault: meta, path: vaultPath };
  });

  const resolveActiveVault = async (): Promise<{
    vault: VaultMeta;
    path: string;
  }> => {
    await deps.ensureInitialized();

    if (activeVault) {
      return { vault: activeVault.meta, path: activeVault.path };
    }

    return resolveActiveVaultShared();
  };

  return {
    listVaultEntries,
    async listVaults() {
      const entries = await listVaultEntries();
      return entries.map((entry) => entry.meta);
    },
    async getActiveVaultMeta() {
      const { vault } = await resolveActiveVault();
      return vault;
    },
    async switchVault(vaultId) {
      const entries = await listVaultEntries();
      const selected = entries.find((entry) => entry.meta.id === vaultId);
      if (!selected) {
        throw new Error(`Vault not found: ${vaultId}`);
      }

      await assertVaultTreeLayout(deps.getContext().fs, selected.path);

      activeVault = selected;
      deps.enableVaultWatcher(vaultId);
      await deps.stopVaultFilesystemWatcher();
      await deps.clearDashboardSnapshot();
      await deps.updateAppSettings({ active_vault_id: vaultId });
      return selected.meta;
    },
    async setDefaultVault(vaultId) {
      const ctx = deps.getContext();
      const entries = await listVaultEntries();
      const selected = entries.find((entry) => entry.meta.id === vaultId);
      if (!selected) {
        throw new Error(`Vault not found: ${vaultId}`);
      }

      const timestamp = deps.nowIso?.() ?? new Date().toISOString();
      for (const entry of entries) {
        const isDefault = entry.meta.id === vaultId;
        if (entry.meta.is_default === isDefault) {
          continue;
        }

        const updated: VaultMeta = {
          ...entry.meta,
          is_default: isDefault,
          updated_at: timestamp,
        };
        await writeVaultMeta(ctx.fs, entry.path, updated);
        await ctx.index.upsertVault(updated, entry.path);

        if (activeVault?.meta.id === entry.meta.id) {
          activeVault = { meta: updated, path: entry.path };
        }
      }
    },
    resolveActiveVault,
    ensureActiveVault: resolveActiveVault,
    getActiveVaultEntry() {
      return activeVault;
    },
    clearActiveVault() {
      activeVault = null;
    },
  };
}
