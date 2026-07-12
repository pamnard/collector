import { useCallback, useEffect, useState } from "react";
import type { VaultMeta } from "@collector/shared";
import { useShell } from "../components/layout/AppLayout";
import { useTheme } from "../hooks/useTheme";
import { useViewMode } from "../hooks/useViewMode";
import {
  getActiveVaultMeta,
  getDataDirectory,
  listVaults,
  setDefaultVault,
  switchVault,
} from "../services/collector-service";

export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { viewMode } = useViewMode();
  const { refreshVault } = useShell();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [isSavingVault, setIsSavingVault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const [directory, loadedVaults, activeVault] = await Promise.all([
      getDataDirectory(),
      listVaults(),
      getActiveVaultMeta(),
    ]);
    setDataDir(directory);
    setVaults(loadedVaults);
    setActiveVaultId(activeVault.id);
  }, []);

  useEffect(() => {
    loadSettings().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [loadSettings]);

  const handleVaultChange = async (vaultId: string) => {
    setIsSavingVault(true);
    setError(null);

    try {
      await switchVault(vaultId);
      await setDefaultVault(vaultId);
      await loadSettings();
      refreshVault();
      setActiveVaultId(vaultId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingVault(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Настройки</h1>

      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      <section className="rounded-xl border border-border bg-card divide-y divide-border">
        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Тема</p>
            <p className="text-secondary text-sm">
              {theme === "dark" ? "Тёмная" : "Светлая"}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="px-3 py-1.5 rounded-lg border border-border hover:bg-input/40 transition-colors text-sm"
          >
            Переключить
          </button>
        </div>

        <div className="p-4">
          <p className="font-medium">Вид по умолчанию</p>
          <p className="text-secondary text-sm mt-1">
            {viewMode === "grid" ? "Сетка" : "Таблица"}
          </p>
        </div>

        <div className="p-4">
          <p className="font-medium">Vault по умолчанию</p>
          {vaults.length > 0 && activeVaultId ? (
            <select
              value={activeVaultId}
              disabled={isSavingVault}
              onChange={(event) => handleVaultChange(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
            >
              {vaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                  {vault.is_default ? " (по умолчанию)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-muted text-sm mt-1">Загрузка…</p>
          )}
        </div>

        <div className="p-4">
          <p className="font-medium">Каталог данных</p>
          {dataDir ? (
            <p className="text-secondary text-sm mt-1 break-all">{dataDir}</p>
          ) : (
            <p className="text-muted text-sm mt-1">Загрузка…</p>
          )}
        </div>

        <div className="p-4">
          <p className="font-medium">Версия</p>
          <p className="text-secondary text-sm mt-1">{__APP_VERSION__}</p>
        </div>
      </section>
    </div>
  );
}
