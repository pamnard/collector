import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { ItemFlagActions } from "../components/items/ItemFlagActions";
import { useShell } from "../components/layout/AppLayout";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  ensureActiveVault,
  listItems,
  searchItems,
} from "../services/collector-service";
import { filterItems } from "../utils/filterItems";

export function DashboardPage() {
  const { viewMode, searchQuery, activeFilter, vaultRevision, refreshVault } =
    useShell();
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemFile[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [vaultName, setVaultName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsSearching(true);
    setError(null);

    const loadItems = async () => {
      const { vault } = await ensureActiveVault();
      if (cancelled) {
        return;
      }

      setVaultName(vault.name);

      const trimmedSearch = debouncedSearch.trim();
      if (trimmedSearch) {
        const results = await searchItems(trimmedSearch, activeFilter);
        if (cancelled) {
          return;
        }
        setItems(results);
        const allItems = await listItems();
        if (cancelled) {
          return;
        }
        setTotalItems(allItems.length);
        return;
      }

      const loadedItems = await listItems();
      if (cancelled) {
        return;
      }
      setItems(loadedItems);
      setTotalItems(loadedItems.length);
    };

    loadItems()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [vaultRevision, debouncedSearch, activeFilter]);

  const visibleItems = debouncedSearch.trim()
    ? items
    : filterItems(items, activeFilter);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{vaultName || "Vault"}</h1>
        <p className="text-secondary text-sm mt-1">
          {visibleItems.length} из {totalItems}
          {isSearching ? " · поиск…" : ""}
        </p>
      </div>

      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {visibleItems.length === 0 && !error && !isSearching && (
        <p className="text-secondary">Ничего не найдено.</p>
      )}

      {viewMode === "grid" ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visibleItems.map((item) => (
            <li key={item.id}>
              <div className="rounded-xl border border-border bg-card p-4 hover:border-indigo-500/40 hover:bg-input/20 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/item/${item.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="font-medium truncate">{item.title}</p>
                    {item.description && (
                      <p className="text-secondary text-sm mt-1 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    <p className="text-muted text-xs mt-2">{item.content_type}</p>
                  </button>
                  <ItemFlagActions
                    itemId={item.id}
                    isFavorite={item.is_favorite}
                    isArchived={item.is_archived}
                    onUpdated={refreshVault}
                    compact
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-input/30 text-secondary">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Название</th>
                <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">
                  Тип
                </th>
                <th className="text-right px-4 py-2 font-medium w-24">
                  Флаги
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate(`/item/${item.id}`)}
                  className="border-t border-border hover:bg-input/20 cursor-pointer"
                >
                  <td className="px-4 py-3">{item.title}</td>
                  <td className="px-4 py-3 text-secondary hidden sm:table-cell">
                    {item.content_type}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ItemFlagActions
                      itemId={item.id}
                      isFavorite={item.is_favorite}
                      isArchived={item.is_archived}
                      onUpdated={refreshVault}
                      compact
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
