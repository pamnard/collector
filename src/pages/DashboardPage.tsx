import { useShell } from "../components/layout/AppLayout";
import { ItemGridView } from "../components/items/ItemGridView";
import { ItemTableView } from "../components/items/ItemTableView";

export function DashboardPage() {
  const { viewMode, refreshVault, dashboardCache: dashboard } = useShell();

  return (
    <div className="p-4 pb-20 md:p-8">
      {dashboard.totalCount === 0 &&
        !dashboard.error &&
        !dashboard.isLoading && (
        <p className="text-secondary">Ничего не найдено.</p>
      )}

      {viewMode === "grid" ? (
        <ItemGridView dashboard={dashboard} />
      ) : (
        <ItemTableView dashboard={dashboard} onUpdated={refreshVault} />
      )}
    </div>
  );
}
