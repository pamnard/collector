import { useShell } from "../components/layout/AppLayout";
import { ItemGridView } from "../components/items/ItemGridView";
import { ItemTableView } from "../components/items/ItemTableView";
import { useDashboardItems } from "../hooks/useDashboardItems";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ensureActiveVault } from "../services/collector-service";
import { useEffect, useState } from "react";

export function DashboardPage() {
  const { viewMode, searchQuery, activeFilter, vaultRevision, refreshVault } =
    useShell();
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [vaultName, setVaultName] = useState("");
  const dashboard = useDashboardItems(
    activeFilter,
    debouncedSearch,
    vaultRevision,
  );

  useEffect(() => {
    void ensureActiveVault().then(({ vault }) => setVaultName(vault.name));
  }, [vaultRevision]);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{vaultName || "Vault"}</h1>
        <p className="text-secondary text-sm mt-1">
          {dashboard.items.length} из {dashboard.totalCount}
          {dashboard.isLoading ? " · загрузка…" : ""}
        </p>
      </div>

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
