import { Spinner } from "../ui/spinner";

interface IndexingStatusMessageProps {
  label: string;
}

/** Spinner + label body for layout indexing/loading alerts (AlertHost wraps Alert). */
export function IndexingStatusMessage({ label }: IndexingStatusMessageProps) {
  return (
    <div className="flex items-center gap-2">
      <Spinner className="shrink-0 text-amber-600 dark:text-amber-400" />
      <span>{label}</span>
    </div>
  );
}
