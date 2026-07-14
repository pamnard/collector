interface StartupErrorScreenProps {
  message: string;
}

export function StartupErrorScreen({ message }: StartupErrorScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-main p-6 font-sans text-primary">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">Не удалось запустить Collector</h1>
        <p className="text-secondary text-sm">
          Приложение не может открыть локальную базу данных. Перезапустите
          приложение — при успешном старте индекс пересоздаётся автоматически из
          файлов vault.
        </p>
        <pre className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap text-sm">
          {message}
        </pre>
      </div>
    </div>
  );
}
