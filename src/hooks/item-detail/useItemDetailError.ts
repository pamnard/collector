import { useCallback, useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../../components/alerts/AlertBusProvider";

export const ITEM_DETAIL_ERROR_ID = "item-detail-error";

export function useItemDetailError() {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([ITEM_DETAIL_ERROR_ID]);
  const [error, setErrorState] = useState<string | null>(null);

  const setError = useCallback(
    (message: string | null) => {
      setErrorState(message);
      if (message) {
        alerts.upsert(ITEM_DETAIL_ERROR_ID, {
          tone: "danger",
          message,
        });
        return;
      }
      alerts.dismiss(ITEM_DETAIL_ERROR_ID);
    },
    [alerts],
  );

  return { error, setError };
}
