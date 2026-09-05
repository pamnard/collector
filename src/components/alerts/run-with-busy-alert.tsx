import type { AlertsApi } from "./alert-store";
import { errorMessage } from "./alert-store";
import { IndexingStatusMessage } from "./IndexingStatusMessage";

type RunWithBusyAlertOptions<T> = {
  busyId: string;
  errorId: string;
  label: string;
  run: () => Promise<T>;
  /** Short user-facing error; full error goes to `detail`. */
  errorSummary?: string;
  /** When true, rethrow after surfacing the error (e.g. ConfirmDialog keep-open). */
  rethrow?: boolean;
};

export async function runWithBusyAlert<T>(
  alerts: AlertsApi,
  options: RunWithBusyAlertOptions<T>,
): Promise<T | undefined> {
  alerts.dismiss(options.errorId);
  alerts.upsert(options.busyId, {
    tone: "warning",
    dismissible: false,
    message: <IndexingStatusMessage label={options.label} />,
  });
  try {
    const result = await options.run();
    alerts.dismiss(options.busyId);
    return result;
  } catch (error) {
    alerts.dismiss(options.busyId);
    const detail = errorMessage(error);
    const summary = options.errorSummary?.trim();
    alerts.upsert(options.errorId, {
      tone: "danger",
      message: summary && summary.length > 0 ? summary : detail,
      detail: summary && summary.length > 0 ? detail : undefined,
    });
    if (options.rethrow) {
      throw error;
    }
    return undefined;
  }
}
