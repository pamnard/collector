import { useEffect, useState } from "react";
import {
  bootstrapDevVault,
  getDataDirectory,
} from "./services/collector-service";
import "./App.css";

interface DevState {
  vaultName: string;
  dataDir: string;
  itemTitles: string[];
}

function App() {
  const [state, setState] = useState<DevState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrapDevVault()
      .then(async ({ vault, items }) => {
        setState({
          vaultName: vault.name,
          dataDir: await getDataDirectory(),
          itemTitles: items.map((item) => item.title),
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  return (
    <main className="container">
      <h1>Collector</h1>
      <p className="subtitle">M0 foundation — vault on disk + SQLite index</p>

      {error && <pre className="error">{error}</pre>}

      {state && (
        <section className="panel">
          <p>
            <strong>Vault:</strong> {state.vaultName}
          </p>
          <p>
            <strong>Data dir:</strong> {state.dataDir}
          </p>
          <p>
            <strong>Items:</strong>
          </p>
          <ul>
            {state.itemTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;
