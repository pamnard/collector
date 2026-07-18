import { useCallback, useEffect, useState } from "react";
import { getName } from "@tauri-apps/api/app";
import { RefreshCw } from "lucide-react";
import type { VaultMeta } from "@collector/shared";
import { useShell } from "../components/layout/AppLayout";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { useTheme } from "../hooks/useTheme";
import { useCheckUpdatesOnStart } from "../hooks/useUpdaterSettings";
import { useViewMode } from "../hooks/useViewMode";
import {
  getActiveVaultMeta,
  getDataDirectory,
  listVaults,
  setDefaultVault,
  switchVault,
} from "../services/collector-service";
import { getAppConfigDirectory } from "../services/app-settings-service";

export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { viewMode } = useViewMode();
  const { refreshVault } = useShell();
  const { enabled: checkUpdatesOnStart, setEnabled: setCheckUpdatesOnStart } =
    useCheckUpdatesOnStart();
  const { progress, checkForUpdates, installUpdate } = useAppUpdater();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [configDir, setConfigDir] = useState<string | null>(null);
  const [appName, setAppName] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [isSavingVault, setIsSavingVault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const [directory, loadedVaults, activeVault, name, preferencesDir] =
      await Promise.all([
      getDataDirectory(),
      listVaults(),
      getActiveVaultMeta(),
      getName().catch(() => "Collector"),
      getAppConfigDirectory(),
    ]);
    setDataDir(directory);
    setConfigDir(preferencesDir);
    setVaults(loadedVaults);
    setActiveVaultId(activeVault.id);
    setAppName(name);
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

      <section className="rounded-lg border border-border bg-card divide-y divide-border">
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
            className="px-3 py-1.5 rounded-lg border border-border hover:bg-input/65 transition-colors text-sm"
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
          {appName && (
            <p className="text-secondary text-sm mt-1">
              Среда: {appName.includes("Dev") ? "разработка" : "release"}
            </p>
          )}
          {dataDir ? (
            <p className="text-secondary text-sm mt-1 break-all">{dataDir}</p>
          ) : (
            <p className="text-muted text-sm mt-1">Загрузка…</p>
          )}
        </div>

        <div className="p-4">
          <p className="font-medium">Настройки приложения</p>
          {configDir ? (
            <p className="text-secondary text-sm mt-1 break-all">
              {configDir}/settings.json
            </p>
          ) : (
            <p className="text-muted text-sm mt-1">Загрузка…</p>
          )}
        </div>

        <div className="p-4">
          <p className="font-medium">Версия</p>
          <p className="text-secondary text-sm mt-1">{__APP_VERSION__}</p>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Обновления</p>
              <p className="text-secondary text-sm mt-1">
                Канал: GitHub Releases (`latest.json`)
              </p>
            </div>
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={progress.stage === "checking" || progress.stage === "downloading" || progress.stage === "installing"}
              className="px-3 py-1.5 rounded-lg border border-border hover:bg-input/65 transition-colors text-sm disabled:opacity-50"
            >
              {progress.stage === "checking" ? "Проверка…" : "Проверить"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Проверять при запуске</p>
              <p className="text-secondary text-sm mt-0.5">
                {checkUpdatesOnStart ? "Включено" : "Выключено"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCheckUpdatesOnStart(!checkUpdatesOnStart)}
              aria-pressed={checkUpdatesOnStart}
              aria-label="Проверять обновления при запуске"
              className={`inline-flex items-center justify-center rounded-lg border p-2 transition-colors ${
                checkUpdatesOnStart
                  ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
                  : "border-border text-secondary hover:bg-input/65 hover:text-primary"
              }`}
            >
              <RefreshCw size={18} />
            </button>
          </div>

          {progress.stage === "available" && (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm space-y-2">
              <p>Доступна версия {progress.version}</p>
              {progress.notes && (
                <p className="text-secondary whitespace-pre-wrap">{progress.notes}</p>
              )}
              <button
                type="button"
                onClick={installUpdate}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors text-sm"
              >
                Установить и перезапустить
              </button>
            </div>
          )}

          {progress.stage === "uptodate" && (
            <p className="text-secondary text-sm">Установлена последняя версия.</p>
          )}

          {progress.stage === "downloading" && (
            <p className="text-secondary text-sm">
              Загрузка…
              {progress.total
                ? ` ${Math.round((progress.downloaded / progress.total) * 100)}%`
                : ""}
            </p>
          )}

          {progress.stage === "installing" && (
            <p className="text-secondary text-sm">Установка…</p>
          )}

          {progress.stage === "error" && (
            <p className="text-red-400 text-sm whitespace-pre-wrap">{progress.message}</p>
          )}
        </div>
      </section>
    </div>
  );
}
