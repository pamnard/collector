import { Alert } from "../alerts/Alert";
import { Spinner } from "../ui/spinner";

interface IndexingStatusAlertProps {
  label: string;
  onDismiss?: () => void;
}

/** Indexing / rebuild status: spinner + label. Not a generic alert. */
export function IndexingStatusAlert({
  label,
  onDismiss,
}: IndexingStatusAlertProps) {
  return (
    <Alert tone="warning" onDismiss={onDismiss}>
      <div className="flex items-center gap-2">
        <Spinner className="shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{label}</span>
      </div>
    </Alert>
  );
}
