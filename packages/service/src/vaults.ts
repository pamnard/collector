/**
 * Vault list/switch/default/ensure (#150).
 * Host injects index boot, watcher stop, settings/snapshot side effects.
 */

import type { AppSettings, ItemFile, VaultMeta } from "@collector/shared";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import {
  createSingleFlight,
  createVault,
  readVaultMeta,
  resolveOrCreateInboxFolder,
  runEmptyVaultBootstrap,
  upsertItem,
  vaultMetaPath,
  vaultRoot,
  vaultsRoot,
  writeVaultMeta,
  type VaultContext,
} from "@collector/core";

export type VaultEntry = { meta: VaultMeta; path: string };

type ActiveVaultState = {
  get: () => VaultEntry | null;
  set: (entry: VaultEntry | null) => void;
};

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

/** Prefer stored id, then is_default, then first entry. */
export function pickVaultEntry(
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

function defaultWelcomeItem(
  vaultId: string,
  inboxFolder: string = INBOX_FOLDER_NAME,
): { item: ItemFile; content: string } {
  const now = new Date().toISOString();
  const fileName = `${crypto.randomUUID()}.md`;
  return {
    item: {
      id: `${inboxFolder}/${fileName}`,
      vault_id: vaultId,
      title: "Welcome to Collector",
      description:
        "First offline item stored on disk and indexed in SQLite.",
      content_type: "note",
      source_type: "manual",
      metadata: {},
      tag_ids: [],
      collection_ids: [],
      folder_path: inboxFolder,
      content_revision: 1,
      created_at: now,
      updated_at: now,
    },
    content: "# Collector\n\nOffline vault is working.",
  };
}

async function listVaultEntriesForDeps(
  deps: VaultsServiceDeps,
): Promise<VaultEntry[]> {
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
      // Orphan/legacy neighbors must not block listing a healthy vault.
      const meta = await readVaultMeta(fs, path);
      entries.push({ meta, path });
    }
  }

  return entries.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

async function tryResolveExistingUnderBootstrap(
  deps: VaultsServiceDeps,
  listVaultEntries: () => Promise<VaultEntry[]>,
  storedVaultId: string | null,
): Promise<{ meta: VaultMeta; path: string } | null> {
  const existingAfterLock = await listVaultEntries();
  const selectedAfterLock = pickVaultEntry(existingAfterLock, storedVaultId);
  if (!selectedAfterLock) {
    return null;
  }
  return {
    meta: selectedAfterLock.meta,
    path: selectedAfterLock.path,
  };
}

async function createDefaultVaultWithWelcome(
  deps: VaultsServiceDeps,
): Promise<{ meta: VaultMeta; path: string }> {
  const ctx = deps.getContext();
  const created = await createVault(ctx, deps.getDataDir(), {
    name: "Default Vault",
    isDefault: true,
  });

  const inboxFolder = await resolveOrCreateInboxFolder(ctx, created.path);
  const welcome =
    deps.createWelcomeItem?.(created.meta.id) ??
    defaultWelcomeItem(created.meta.id, inboxFolder);

  await upsertItem(ctx, created.path, created.meta.id, welcome);

  await deps.updateAppSettings({ active_vault_id: created.meta.id });
  return { meta: created.meta, path: created.path };
}

async function resolveActiveVaultOnce(
  deps: VaultsServiceDeps,
  state: ActiveVaultState,
  listVaultEntries: () => Promise<VaultEntry[]>,
): Promise<{ vault: VaultMeta; path: string }> {
  const cached = state.get();
  if (cached) {
    return { vault: cached.meta, path: cached.path };
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
      tryResolveExisting: () =>
        tryResolveExistingUnderBootstrap(
          deps,
          listVaultEntries,
          storedVaultId,
        ),
      create: () => createDefaultVaultWithWelcome(deps),
    });
    meta = bootstrapped.meta;
    vaultPath = bootstrapped.path;
  }

  state.set({ meta, path: vaultPath });
  return { vault: meta, path: vaultPath };
}

async function switchVaultForDeps(
  deps: VaultsServiceDeps,
  state: ActiveVaultState,
  listVaultEntries: () => Promise<VaultEntry[]>,
  vaultId: string,
): Promise<VaultMeta> {
  const entries = await listVaultEntries();
  const selected = entries.find((entry) => entry.meta.id === vaultId);
  if (!selected) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  state.set(selected);
  deps.enableVaultWatcher(vaultId);
  await deps.stopVaultFilesystemWatcher();
  await deps.clearDashboardSnapshot();
  await deps.updateAppSettings({ active_vault_id: vaultId });
  return selected.meta;
}

async function setDefaultVaultForDeps(
  deps: VaultsServiceDeps,
  state: ActiveVaultState,
  listVaultEntries: () => Promise<VaultEntry[]>,
  vaultId: string,
): Promise<void> {
  const ctx = deps.getContext();
  const entries = await listVaultEntries();
  const selected = entries.find((entry) => entry.meta.id === vaultId);
  if (!selected) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  const timestamp = deps.nowIso?.() ?? new Date().toISOString();
  const active = state.get();
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

    if (active?.meta.id === entry.meta.id) {
      state.set({ meta: updated, path: entry.path });
    }
  }
}

export function createVaultsService(deps: VaultsServiceDeps): VaultsService {
  let activeVault: VaultEntry | null = null;
  const state: ActiveVaultState = {
    get: () => activeVault,
    set: (entry) => {
      activeVault = entry;
    },
  };

  const listVaultEntries = () => listVaultEntriesForDeps(deps);
  const resolveActiveVaultShared = createSingleFlight(() =>
    resolveActiveVaultOnce(deps, state, listVaultEntries),
  );

  const resolveActiveVault = async (): Promise<{
    vault: VaultMeta;
    path: string;
  }> => {
    await deps.ensureInitialized();

    const cached = state.get();
    if (cached) {
      return { vault: cached.meta, path: cached.path };
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
    switchVault: (vaultId) =>
      switchVaultForDeps(deps, state, listVaultEntries, vaultId),
    setDefaultVault: (vaultId) =>
      setDefaultVaultForDeps(deps, state, listVaultEntries, vaultId),
    resolveActiveVault,
    ensureActiveVault: resolveActiveVault,
    getActiveVaultEntry() {
      return state.get();
    },
    clearActiveVault() {
      state.set(null);
    },
  };
}
