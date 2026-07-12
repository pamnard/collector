import { useEffect, useState } from "react";
import { useTheme } from "../hooks/useTheme";
import { useViewMode } from "../hooks/useViewMode";
import { getDataDirectory } from "../services/collector-service";

export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { viewMode } = useViewMode();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDataDirectory()
      .then(setDataDir)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

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
          <p className="font-medium">Каталог данных</p>
          {dataDir ? (
            <p className="text-secondary text-sm mt-1 break-all">{dataDir}</p>
          ) : (
            <p className="text-muted text-sm mt-1">Загрузка…</p>
          )}
        </div>

        <div className="p-4">
          <p className="font-medium">Версия</p>
          <p className="text-secondary text-sm mt-1">0.1.0</p>
        </div>
      </section>
    </div>
  );
}
