import { useShell } from "../components/layout/AppLayout";
import { ItemGridView } from "../components/items/ItemGridView";
import { ItemTableView } from "../components/items/ItemTableView";
import { useDashboardItems } from "../hooks/useDashboardItems";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

export function DashboardPage() {
  const { viewMode, searchQuery, activeFilter, vaultRevision, refreshVault } =
    useShell();
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const dashboard = useDashboardItems(
    activeFilter,
    debouncedSearch,
    vaultRevision,
  );

  return (
    <div className="p-4 pb-20 md:p-8">
      {dashboard.error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {dashboard.error}
        </pre>
      )}

      {dashboard.totalCount === 0 && !dashboard.error && !dashboard.isLoading && (
        <p className="text-secondary">Ничего не найдено.</p>
      )}

      {viewMode === "grid" ? (
        <ItemGridView dashboard={dashboard} onUpdated={refreshVault} />
      ) : (
        <ItemTableView dashboard={dashboard} onUpdated={refreshVault} />
      )}
    </div>
  );
}
