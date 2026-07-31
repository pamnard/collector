import { useCallback, useEffect, useMemo, useState } from "react";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { getCollectorService } from "../services/collector-client";
import { TelegramBrandIcon } from "../components/TelegramBrandIcon";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

type FolderOption = { path: string; label: string };

function flattenFolders(
  nodes: Array<{ path: string; name: string; children: unknown[] }>,
  depth = 0,
): FolderOption[] {
  const out: FolderOption[] = [];
  for (const node of nodes) {
    out.push({
      path: node.path,
      label: `${"—".repeat(depth)}${depth ? " " : ""}${node.name}`,
    });
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.push(
        ...flattenFolders(
          node.children as Array<{
            path: string;
            name: string;
            children: unknown[];
          }>,
          depth + 1,
        ),
      );
    }
  }
  return out;
}

export function TelegramSettingsSection() {
  const service = getCollectorService();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [folderPath, setFolderPath] = useState(INBOX_FOLDER_NAME);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [credReason, setCredReason] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const credsAvailable = credReason === null && !loading;

  const reload = useCallback(async () => {
    setInlineError(null);
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
  }, [service]);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setInlineError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, [reload]);

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
    setInlineError(null);
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
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clearToken = async () => {
    if (!window.confirm("Удалить токен бота из связки ключей?")) {
      return;
    }
    setBusy(true);
    setInlineError(null);
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
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    setBusy(true);
    setInlineError(null);
    try {
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        enabled: next,
      });
      setEnabled(settings.enabled);
    } catch (err: unknown) {
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const changeFolder = async (next: string) => {
    setBusy(true);
    setInlineError(null);
    try {
      const settings = await service.telegramSync.updateTelegramSyncSettings({
        folder_path: next,
      });
      setFolderPath(settings.folder_path);
    } catch (err: unknown) {
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setInlineError(null);
    try {
      await service.syncPlugins.syncNow("telegram");
      const settings = await service.telegramSync.getTelegramSyncSettings();
      setLastSyncAt(settings.last_sync_at);
    } catch (err: unknown) {
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl pb-4 md:pb-8">
      {inlineError && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {inlineError}
        </pre>
      )}

      <section className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 divide-y divide-black/10 dark:divide-white/10">
        <div className="p-4 flex items-center gap-3">
          <TelegramBrandIcon className="size-6 text-[#26A5E4]" />
          <div>
            <p className="font-medium">Telegram</p>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">
              Пересылай сообщения своему боту — Collector заберёт их в vault.
            </p>
          </div>
        </div>

        {credReason ? (
          <div className="p-4 text-amber-700 dark:text-amber-300">
            {credReason}
          </div>
        ) : null}

        <div className="p-4">
          <p className="font-medium">Как настроить</p>
          <ol className="list-decimal list-inside text-neutral-500 dark:text-neutral-400 space-y-1 mt-1">
            <li>Создай бота у @BotFather и скопируй токен.</li>
            <li>Вставь токен ниже и сохрани.</li>
            <li>Напиши боту /start, затем шли или пересылай сообщения.</li>
            <li>Нажми «Синхронизировать» или просто открой приложение снова.</li>
          </ol>
        </div>

        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Включить</p>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">
              {enabled ? "Синхронизация включена" : "Синхронизация выключена"}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={busy || loading}
            onCheckedChange={(checked) => {
              void toggleEnabled(checked);
            }}
            aria-label="Включить синхронизацию"
          />
        </div>

        <div className="p-4">
          <p className="font-medium">Токен бота</p>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            {hasToken
              ? `Токен сохранён${botUsername ? ` · @${botUsername}` : ""}. Полный токен не показывается.`
              : "Токен ещё не сохранён."}
          </p>
          <Input
            type="password"
            autoComplete="off"
            placeholder={hasToken ? "Новый токен (замена)" : "123456:ABC..."}
            value={tokenDraft}
            disabled={busy || loading}
            onChange={(e) => setTokenDraft(e.target.value)}
            className="mt-2"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                !credsAvailable || busy || loading || !tokenDraft.trim()
              }
              onClick={() => void saveToken()}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
            >
              Сохранить токен
            </button>
            <button
              type="button"
              disabled={!credsAvailable || busy || loading || !hasToken}
              onClick={() => void clearToken()}
              className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-sm disabled:opacity-50"
            >
              Очистить токен
            </button>
          </div>
        </div>

        <div className="p-4">
          <p className="font-medium">Папка назначения</p>
          <Select
            value={folderPath}
            onValueChange={(value) => {
              if (typeof value !== "string") {
                throw new Error("folder_path must be a string");
              }
              void changeFolder(value);
            }}
            disabled={busy || loading}
            items={folderItems}
          >
            <SelectTrigger className="mt-2 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {folderItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Синхронизация</p>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">
              Последняя: {lastSyncLabel}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void syncNow()}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
          >
            Синхронизировать
          </button>
        </div>
      </section>
    </div>
  );
}
