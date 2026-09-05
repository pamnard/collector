import { Alert } from "./Alert";
import { AlertStack } from "./AlertStack";
import { useAlertEntries, useAlerts } from "./AlertBusProvider";

/** Single app-wide AlertStack host. Only this module may mount AlertStack. */
export function AlertHost() {
  const entries = useAlertEntries();
  const alerts = useAlerts();

  if (entries.length === 0) {
    return null;
  }

  return (
    <AlertStack>
      {entries.map((entry) => (
        <Alert
          key={entry.id}
          tone={entry.tone}
          detail={entry.detail}
          onDismiss={
            entry.dismissible
              ? () => {
                  entry.onDismiss?.();
                  alerts.dismiss(entry.id);
                }
              : undefined
          }
        >
          {entry.message}
        </Alert>
      ))}
    </AlertStack>
  );
}
