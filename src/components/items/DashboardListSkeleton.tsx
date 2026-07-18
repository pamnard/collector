const SKELETON_COUNT = 8;

export function DashboardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="min-h-[280px] animate-pulse rounded-lg border border-border-card bg-card/50"
        />
      ))}
    </div>
  );
}

export function DashboardTableSkeleton() {
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-input/30 text-secondary">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Название</th>
            <th className="text-left px-4 py-2 font-medium w-28">Тип</th>
            <th className="text-left px-4 py-2 font-medium min-w-[120px]">
              Теги
            </th>
            <th className="text-left px-4 py-2 font-medium w-28 whitespace-nowrap">
              Обновлено
            </th>
            <th className="text-right px-4 py-2 font-medium w-32">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <tr key={index} className="border-t border-border" aria-hidden>
              <td className="px-4 py-3">
                <div className="h-4 w-48 max-w-full animate-pulse rounded-md bg-input" />
                <div className="mt-2 h-3 w-32 max-w-full animate-pulse rounded-md bg-input/70" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-16 animate-pulse rounded-md bg-input" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-24 animate-pulse rounded-md bg-input" />
              </td>
              <td className="px-4 py-3">
                <div className="h-4 w-20 animate-pulse rounded-md bg-input" />
              </td>
              <td className="px-4 py-3" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
