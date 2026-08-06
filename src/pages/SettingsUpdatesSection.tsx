import { ExternalLink, RefreshCw } from "lucide-react";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { useCheckUpdatesOnStart } from "../hooks/useUpdaterSettings";

export function SettingsUpdatesSection() {
  const { enabled: checkUpdatesOnStart, setEnabled: setCheckUpdatesOnStart } =
    useCheckUpdatesOnStart();
  const { progress, checkForUpdates, openReleasesPage, releasesUrl } =
    useAppUpdater();

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Обновления</p>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1">
            Канал: GitHub Releases (ручная установка архива)
          </p>
        </div>
        <button
          type="button"
          onClick={openReleasesPage}
          className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 transition-colors text-sm inline-flex items-center gap-1.5"
        >
          <ExternalLink size={14} />
          Releases
        </button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Напоминание при запуске</p>
          <p className="text-neutral-500 dark:text-neutral-400 mt-0.5">
            {checkUpdatesOnStart
              ? "Показывать ссылку на Releases"
              : "Выключено"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCheckUpdatesOnStart(!checkUpdatesOnStart)}
          aria-pressed={checkUpdatesOnStart}
          aria-label="Напоминать об обновлениях при запуске"
          className={`inline-flex items-center justify-center rounded-lg border p-2 transition-colors ${
            checkUpdatesOnStart
              ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
              : "border-black/10 dark:border-white/10 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 hover:text-neutral-900 dark:hover:text-neutral-100"
          }`}
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <p className="text-neutral-500 dark:text-neutral-400 text-sm">
        Скачайте архив с{" "}
        <a
          href={releasesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          GitHub Releases
        </a>
        , остановите хост и замените файлы. Автоустановка в приложении не
        поддерживается.
      </p>

      <button
        type="button"
        onClick={checkForUpdates}
        className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 transition-colors text-sm"
      >
        Как обновиться
      </button>

      {progress.stage === "error" && (
        <p className="text-neutral-500 dark:text-neutral-400 whitespace-pre-wrap text-sm">
          {progress.message}
        </p>
      )}
    </div>
  );
}
