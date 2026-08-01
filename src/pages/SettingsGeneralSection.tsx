import { useCallback, useEffect, useMemo, useState } from "react";
import { getName } from "@tauri-apps/api/app";
import type { VaultMeta } from "@collector/shared";
import { useShell } from "../components/layout/AppLayout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { getCollectorService } from "../services/collector-client";

interface SettingsGeneralSectionProps {
  onError: (message: string | null) => void;
}

export function SettingsGeneralSection({ onError }: SettingsGeneralSectionProps) {
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

  const vaultItems = useMemo(
    () =>
      vaults.map((vault) => ({
        value: vault.id,
        label: vault.is_default
          ? `${vault.name} (по умолчанию)`
          : vault.name,
      })),
    [vaults],
  );

  return (
    <>
      <div className="p-4">
        <p className="font-medium">Vault по умолчанию</p>
        {vaults.length > 0 && activeVaultId ? (
          <Select
            value={activeVaultId}
            disabled={isSavingVault}
            onValueChange={(next) => {
              if (typeof next !== "string") {
                throw new Error("vault id must be a string");
              }
              void handleVaultChange(next);
            }}
            items={vaultItems}
          >
            <SelectTrigger className="mt-2 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {vaultItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
