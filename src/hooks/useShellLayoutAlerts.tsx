import { useCallback, useEffect, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import type {
  DerivedCatchUpStatus,
  VaultIndexSyncStatus,
} from "@collector/api";
import {
  formatDerivedCatchUpBannerLabel,
  formatIndexingBannerLabel,
} from "@collector/core";
import { useAlerts } from "../components/alerts/AlertBusProvider";
import { IndexingStatusMessage } from "../components/alerts/IndexingStatusMessage";
import {
  useCheckUpdatesOnStart,
  useStartupUpdateCheck,
} from "./useUpdaterSettings";
import {
  SHELL_LAYOUT_ALERT_IDS,
  dashboardLoadingAlertDecision,
  dashboardErrorAlertDecision,
  derivedCatchUpAlertDecision,
  indexingAlertDecision,
  updateAlertDecision,
} from "./shell-layout-alerts";

export type UseShellLayoutAlertsInput = {
  dashboardLoading: boolean;
  dashboardError: string | null;
  indexSync: VaultIndexSyncStatus;
  derivedCatchUp: DerivedCatchUpStatus;
  navigate: NavigateFunction;
};

/**
 * Layout status → AlertStack only.
 * Must run under AlertBusProvider.
 */
export function useShellLayoutAlerts({
  dashboardLoading,
  dashboardError,
  indexSync,
  derivedCatchUp,
  navigate,
}: UseShellLayoutAlertsInput): void {
  const alerts = useAlerts();
  const { enabled: checkUpdatesOnStart } = useCheckUpdatesOnStart();
  const [startupUpdateVersion, setStartupUpdateVersion] = useState<
    string | null
  >(null);
  /** Dismissed dashboard error message; new/different errors show again. */
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const isMetadataIndexing =
    indexSync.status === "rebuilding" ||
    (indexSync.status === "running" && !indexSync.metadataReady);
  const indexingLabel = formatIndexingBannerLabel(indexSync);
  const isDerivedCatchUpRunning = derivedCatchUp.status === "running";
  const derivedCatchUpLabel = formatDerivedCatchUpBannerLabel(derivedCatchUp);

  const handleStartupUpdateFound = useCallback((version: string) => {
    setStartupUpdateVersion(version);
  }, []);

  useStartupUpdateCheck(checkUpdatesOnStart, handleStartupUpdateFound);

  useEffect(() => {
    if (dashboardLoadingAlertDecision(dashboardLoading) === "upsert") {
      alerts.upsert(SHELL_LAYOUT_ALERT_IDS.loading, {
        tone: "warning",
        dismissible: false,
        message: <IndexingStatusMessage label="Загрузка…" />,
      });
    } else {
      alerts.dismiss(SHELL_LAYOUT_ALERT_IDS.loading);
    }
  }, [alerts, dashboardLoading]);

  useEffect(() => {
    if (indexingAlertDecision(isMetadataIndexing) === "upsert") {
      alerts.upsert(SHELL_LAYOUT_ALERT_IDS.indexing, {
        tone: "warning",
        dismissible: false,
        message: <IndexingStatusMessage label={indexingLabel} />,
      });
    } else {
      alerts.dismiss(SHELL_LAYOUT_ALERT_IDS.indexing);
    }
  }, [alerts, indexingLabel, isMetadataIndexing]);

  useEffect(() => {
    if (derivedCatchUpAlertDecision(isDerivedCatchUpRunning) === "upsert") {
      alerts.upsert(SHELL_LAYOUT_ALERT_IDS.derivedCatchUp, {
        tone: "warning",
        dismissible: false,
        message: <IndexingStatusMessage label={derivedCatchUpLabel} />,
      });
    } else {
      alerts.dismiss(SHELL_LAYOUT_ALERT_IDS.derivedCatchUp);
    }
  }, [alerts, derivedCatchUpLabel, isDerivedCatchUpRunning]);

  useEffect(() => {
    if (
      dashboardErrorAlertDecision(dashboardError, dismissedError) === "upsert" &&
      dashboardError !== null
    ) {
      alerts.upsert(SHELL_LAYOUT_ALERT_IDS.error, {
        tone: "danger",
        message: dashboardError,
        onDismiss: () => setDismissedError(dashboardError),
      });
    } else {
      alerts.dismiss(SHELL_LAYOUT_ALERT_IDS.error);
    }
  }, [alerts, dashboardError, dismissedError]);

  useEffect(() => {
    if (updateAlertDecision(startupUpdateVersion) === "dismiss") {
      alerts.dismiss(SHELL_LAYOUT_ALERT_IDS.update);
      return;
    }
    const version = startupUpdateVersion;
    if (version === null) {
      return;
    }
    alerts.upsert(SHELL_LAYOUT_ALERT_IDS.update, {
      tone: "info",
      message: (
        <div className="flex flex-wrap items-center gap-2">
          <span>Доступно обновление {version}.</span>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="rounded-lg border border-indigo-500/40 px-3 py-1 hover:bg-indigo-500/10 transition-colors"
          >
            Настройки
          </button>
        </div>
      ),
      onDismiss: () => setStartupUpdateVersion(null),
    });
  }, [alerts, navigate, startupUpdateVersion]);
}
