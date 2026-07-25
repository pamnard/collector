const SKELETON_COUNT = 8;

export function DashboardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="min-h-[280px] animate-pulse rounded-lg border border-black/10 dark:border-white/10 bg-white/50 dark:bg-neutral-800/50"
        />
      ))}
    </div>
  );
}

export function DashboardTableSkeleton() {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-neutral-100/30 dark:bg-neutral-700/30 text-neutral-500 dark:text-neutral-400">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Название</th>
            <th className="w-28 text-left px-4 py-2 font-medium">Тип</th>
            <th className="w-40 text-left px-4 py-2 font-medium">Теги</th>
            <th className="w-28 text-left px-4 py-2 font-medium whitespace-nowrap">
              Обновлено
            </th>
            <th className="w-32 text-right px-4 py-2 font-medium">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <tr key={index} className="border-t border-black/10 dark:border-white/10" aria-hidden>
              <td className="px-4 py-3">
                <div className="h-4 w-48 max-w-full animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
                <div className="mt-2 h-3 w-32 max-w-full animate-pulse rounded-md bg-neutral-100/70 dark:bg-neutral-700/70" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-16 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-24 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-20 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-700" />
              </td>
              <td className="px-4 py-3" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
