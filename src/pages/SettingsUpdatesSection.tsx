import { RefreshCw } from "lucide-react";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { useCheckUpdatesOnStart } from "../hooks/useUpdaterSettings";

export function SettingsUpdatesSection() {
  const { enabled: checkUpdatesOnStart, setEnabled: setCheckUpdatesOnStart } =
    useCheckUpdatesOnStart();
  const { progress, checkForUpdates, installUpdate } = useAppUpdater();

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Обновления</p>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">
            Канал: GitHub Releases (`latest.json`)
          </p>
        </div>
        <button
          type="button"
          onClick={checkForUpdates}
          disabled={
            progress.stage === "checking" ||
            progress.stage === "downloading" ||
            progress.stage === "installing"
          }
          className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 transition-colors text-sm disabled:opacity-50"
        >
          {progress.stage === "checking" ? "Проверка…" : "Проверить"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-sm">Проверять при запуске</p>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-0.5">
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
              : "border-black/10 dark:border-white/10 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {progress.stage === "available" && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm space-y-2">
          <p>Доступна версия {progress.version}</p>
          {progress.notes && (
            <p className="text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap">
              {progress.notes}
            </p>
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
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">
          Установлена последняя версия.
        </p>
      )}

      {progress.stage === "downloading" && (
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">
          Загрузка…
          {progress.total
            ? ` ${Math.round((progress.downloaded / progress.total) * 100)}%`
            : ""}
        </p>
      )}

      {progress.stage === "installing" && (
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">
          Установка…
        </p>
      )}

      {progress.stage === "error" && (
        <p className="text-red-400 text-sm whitespace-pre-wrap">
          {progress.message}
        </p>
      )}
    </div>
  );
}
