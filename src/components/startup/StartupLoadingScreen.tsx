export function StartupLoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white dark:bg-neutral-800 p-6 font-sans text-neutral-900 dark:text-neutral-100">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500" />
      <p className="text-neutral-500 dark:text-neutral-400 text-sm">Запуск Collector…</p>
    </div>
  );
}
