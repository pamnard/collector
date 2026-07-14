export function StartupLoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-main p-6 font-sans text-primary">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500" />
      <p className="text-secondary text-sm">Запуск Collector…</p>
    </div>
  );
}
