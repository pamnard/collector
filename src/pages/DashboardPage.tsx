import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { useShell } from "../components/layout/AppLayout";
import { ensureActiveVault, listItems } from "../services/collector-service";
import { filterItems } from "../utils/filterItems";

export function DashboardPage() {
  const { viewMode, searchQuery, activeFilter, vaultRevision } = useShell();
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemFile[]>([]);
  const [vaultName, setVaultName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([ensureActiveVault(), listItems()])
      .then(([{ vault }, loadedItems]) => {
        setVaultName(vault.name);
        setItems(loadedItems);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [vaultRevision]);

  const visibleItems = filterItems(items, activeFilter, searchQuery);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{vaultName || "Vault"}</h1>
        <p className="text-secondary text-sm mt-1">
          {visibleItems.length} из {items.length}
        </p>
      </div>

      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {visibleItems.length === 0 && !error && (
        <p className="text-secondary">Ничего не найдено.</p>
      )}

      {viewMode === "grid" ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visibleItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate(`/item/${item.id}`)}
                className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-indigo-500/40 hover:bg-input/20 transition-colors"
              >
                <p className="font-medium truncate">{item.title}</p>
                {item.description && (
                  <p className="text-secondary text-sm mt-1 line-clamp-2">
                    {item.description}
                  </p>
                )}
                <p className="text-muted text-xs mt-2">{item.content_type}</p>
              </button>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
