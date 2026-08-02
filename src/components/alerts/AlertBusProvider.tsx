import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createAlertStore,
  type AlertEntry,
  type AlertStore,
  type AlertsApi,
} from "./alert-store";

const AlertBusContext = createContext<AlertStore | null>(null);

export function AlertBusProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<AlertStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createAlertStore();
  }

  return (
    <AlertBusContext.Provider value={storeRef.current}>
      {children}
    </AlertBusContext.Provider>
  );
}

function useAlertStore(): AlertStore {
  const store = useContext(AlertBusContext);
  if (!store) {
    throw new Error("useAlerts must be used within AlertBusProvider");
  }
  return store;
}

export function useAlerts(): AlertsApi {
  return useAlertStore();
}

export function useAlertEntries(): readonly AlertEntry[] {
  const store = useAlertStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/** Dismiss scoped alert ids when the calling component unmounts. */
export function useDismissAlertsOnUnmount(ids: readonly string[]): void {
  const alerts = useAlerts();
  const key = ids.join("\0");
  useEffect(() => {
    const list = key.length === 0 ? [] : key.split("\0");
    return () => {
      for (const id of list) {
        alerts.dismiss(id);
      }
    };
  }, [alerts, key]);
}
