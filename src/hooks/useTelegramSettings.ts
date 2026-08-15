import { useCallback, useEffect, useMemo, useState } from "react";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import { errorMessage } from "../components/alerts/alert-store";
import { getCollectorService } from "../services/collector-client";
import {
  flattenFolders,
  type FolderOption,
} from "./telegram-flatten-folders";

const TELEGRAM_ERROR_ID = "telegram-error";
const TELEGRAM_WARN_ID = "telegram-warn";

export function useTelegramSettings() {
  const service = getCollectorService();
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([TELEGRAM_ERROR_ID, TELEGRAM_WARN_ID]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [folderPath, setFolderPath] = useState(INBOX_FOLDER_NAME);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(5);
  const [hasToken, setHasToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [credReason, setCredReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const credsAvailable = credReason === null && !loading;

  const clearTelegramAlerts = useCallback(() => {
    alerts.dismiss(TELEGRAM_ERROR_ID);
    alerts.dismiss(TELEGRAM_WARN_ID);
  }, [alerts]);

  const showTelegramError = useCallback(
    (message: string) => {
      alerts.upsert(TELEGRAM_ERROR_ID, { tone: "danger", message });
    },
    [alerts],
  );

  const showTelegramWarn = useCallback(
    (message: string | null) => {
      if (message) {
        alerts.upsert(TELEGRAM_WARN_ID, { tone: "warning", message });
      } else {
        alerts.dismiss(TELEGRAM_WARN_ID);
      }
    },
    [alerts],
  );

  const reload = useCallback(async () => {
    clearTelegramAlerts();
    const availability =
      await service.credentials.getCredentialsAvailability();
    if (!availability.available) {
      setCredReason(
        availability.reason ?? "Хранилище секретов недоступно",
      );
    } else {
      setCredReason(null);
    }

    const [settings, tree] = await Promise.all([
      service.telegramSync.getTelegramSyncSettings(),
      service.folders.listFolderTree(),
    ]);
    setEnabled(settings.enabled);
    setFolderPath(settings.folder_path || INBOX_FOLDER_NAME);
    setBotUsername(settings.bot_username);
    setLastSyncAt(settings.last_sync_at);
    setSyncIntervalMinutes(
      Math.max(1, Math.round(settings.sync_interval_ms / 60_000)),
    );
    const warnings = settings.last_pull_warnings ?? [];
    showTelegramWarn(warnings.length > 0 ? warnings.join("\n") : null);
    setFolders(flattenFolders(tree));

    if (availability.available) {
      const tokenPresent = await service.credentials.hasCredential({
        pluginId: "telegram",
        key: "bot_token",
      });
      setHasToken(tokenPresent);
    } else {
      setHasToken(false);
    }
    setLoading(false);
  }, [clearTelegramAlerts, service, showTelegramWarn]);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      showTelegramError(errorMessage(err));
      setLoading(false);
    });
  }, [reload, showTelegramError]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncAt) {
      return "ещё не было";
    }
    return new Date(lastSyncAt).toLocaleString();
  }, [lastSyncAt]);

  const folderItems = useMemo(() => {
    if (folders.length === 0) {
      return [{ value: INBOX_FOLDER_NAME, label: INBOX_FOLDER_NAME }];
    }
    return folders.map((f) => ({ value: f.path, label: f.label }));
  }, [folders]);

  const saveToken = async () => {
    setBusy(true);
    clearTelegramAlerts();
    try {
      const identity = await service.telegramSync.validateTelegramBotToken({
        token: tokenDraft.trim(),
      });
      await service.credentials.setCredential({
        pluginId: "telegram",
        key: "bot_token",
        secret: tokenDraft.trim(),
      });
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        bot_username: identity.username,
        enabled: true,
      });
      setBotUsername(settings.bot_username);
      setEnabled(settings.enabled);
      setHasToken(true);
      setTokenDraft("");
    } catch (err: unknown) {
      showTelegramError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clearToken = async () => {
    if (!window.confirm("Удалить токен бота из связки ключей?")) {
      return;
    }
    setBusy(true);
    clearTelegramAlerts();
    try {
      await service.credentials.deleteCredential({
        pluginId: "telegram",
        key: "bot_token",
      });
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        bot_username: null,
        enabled: false,
      });
      setHasToken(false);
      setBotUsername(settings.bot_username);
      setEnabled(settings.enabled);
    } catch (err: unknown) {
      showTelegramError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    setBusy(true);
    clearTelegramAlerts();
    try {
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        enabled: next,
      });
      setEnabled(settings.enabled);
    } catch (err: unknown) {
      showTelegramError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changeFolder = async (next: string) => {
    setBusy(true);
    clearTelegramAlerts();
    try {
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        folder_path: next,
      });
      setFolderPath(settings.folder_path);
    } catch (err: unknown) {
      showTelegramError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changeIntervalMinutes = async (raw: string) => {
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 1) {
      showTelegramError("Интервал должен быть целым числом минут ≥ 1");
      return;
    }
    setBusy(true);
    clearTelegramAlerts();
    try {
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        sync_interval_ms: Math.floor(minutes) * 60_000,
      });
      setSyncIntervalMinutes(
        Math.max(1, Math.round(settings.sync_interval_ms / 60_000)),
      );
    } catch (err: unknown) {
      showTelegramError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    clearTelegramAlerts();
    try {
      await service.syncPlugins.syncNow("telegram");
      const settings = await service.telegramSync.getTelegramSyncSettings();
      setLastSyncAt(settings.last_sync_at);
      const warnings = settings.last_pull_warnings ?? [];
      showTelegramWarn(warnings.length > 0 ? warnings.join("\n") : null);
    } catch (err: unknown) {
      showTelegramError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    loading,
    busy,
    enabled,
    folderPath,
    botUsername,
    lastSyncLabel,
    syncIntervalMinutes,
    setSyncIntervalMinutes,
    hasToken,
    tokenDraft,
    setTokenDraft,
    folderItems,
    credReason,
    credsAvailable,
    saveToken,
    clearToken,
    toggleEnabled,
    changeFolder,
    changeIntervalMinutes,
    syncNow,
  };
}
