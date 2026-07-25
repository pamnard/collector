import { useShell } from "../components/layout/AppLayout";
import { ItemGridView } from "../components/items/ItemGridView";
import { ItemTableView } from "../components/items/ItemTableView";

export function DashboardPage() {
  const { viewMode, refreshVault, dashboardCache: dashboard } = useShell();

  return (
    <div className="pb-20">
      {dashboard.totalCount === 0 &&
        !dashboard.error &&
        !dashboard.isLoading && (
        <p className="text-neutral-500 dark:text-neutral-400">Ничего не найдено.</p>
      )}

      {viewMode === "grid" ? (
        <ItemGridView dashboard={dashboard} />
      ) : (
        <ItemTableView dashboard={dashboard} onUpdated={refreshVault} />
      )}
    </div>
  );
}
