import { useCallback, useEffect, useState } from "react";
import { getName } from "@tauri-apps/api/app";
import type { VaultMeta } from "@collector/shared";
import { useShell } from "../components/layout/AppLayout";
import { useTheme } from "../hooks/useTheme";
import { useViewMode } from "../hooks/useViewMode";
import { getCollectorService } from "../services/collector-client";

interface SettingsGeneralSectionProps {
  onError: (message: string | null) => void;
}

export function SettingsGeneralSection({ onError }: SettingsGeneralSectionProps) {
  const { theme, toggleTheme } = useTheme();
  const { viewMode } = useViewMode();
  const { refreshVault } = useShell();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [configDir, setConfigDir] = useState<string | null>(null);
  const [appName, setAppName] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [isSavingVault, setIsSavingVault] = useState(false);

  const loadSettings = useCallback(async () => {
    const [directory, loadedVaults, activeVault, name, preferencesDir] =
      await Promise.all([
        getCollectorService().boot.getDataDirectory(),
        getCollectorService().vaults.listVaults(),
        getCollectorService().vaults.getActiveVaultMeta(),
        getName().catch(() => "Collector"),
        getCollectorService().settings.getAppConfigDirectory(),
      ]);
    setDataDir(directory);
    setConfigDir(preferencesDir);
    setVaults(loadedVaults);
    setActiveVaultId(activeVault.id);
    setAppName(name);
  }, []);

  useEffect(() => {
    loadSettings().catch((err: unknown) => {
      onError(err instanceof Error ? err.message : String(err));
    });
  }, [loadSettings, onError]);

  const handleVaultChange = async (vaultId: string) => {
    setIsSavingVault(true);
    onError(null);

    try {
      await getCollectorService().vaults.switchVault(vaultId);
      await getCollectorService().vaults.setDefaultVault(vaultId);
      await loadSettings();
      refreshVault();
      setActiveVaultId(vaultId);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingVault(false);
    }
  };

  return (
    <>
      <div className="p-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Тема</p>
          <p className="text-neutral-500 dark:text-neutral-400">
            {theme === "dark" ? "Тёмная" : "Светлая"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 transition-colors text-sm"
        >
          Переключить
        </button>
      </div>

      <div className="p-4">
        <p className="font-medium">Вид по умолчанию</p>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">
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
            className="mt-2 w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
          >
            {vaults.map((vault) => (
              <option key={vault.id} value={vault.id}>
                {vault.name}
                {vault.is_default ? " (по умолчанию)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-neutral-500 mt-1">Загрузка…</p>
        )}
      </div>

      <div className="p-4">
        <p className="font-medium">Каталог данных</p>
        {appName && (
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            Среда: {appName.includes("Dev") ? "разработка" : "release"}
          </p>
        )}
        {dataDir ? (
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 break-all">
            {dataDir}
          </p>
        ) : (
          <p className="text-neutral-500 mt-1">Загрузка…</p>
        )}
      </div>

      <div className="p-4">
        <p className="font-medium">Настройки приложения</p>
        {configDir ? (
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 break-all">
            {configDir}/settings.json
          </p>
        ) : (
          <p className="text-neutral-500 mt-1">Загрузка…</p>
        )}
      </div>

      <div className="p-4">
        <p className="font-medium">Версия</p>
        <p className="text-neutral-500 dark:text-neutral-400 mt-1">
          {__APP_VERSION__}
        </p>
      </div>
    </>
  );
}
