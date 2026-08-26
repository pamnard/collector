import { useEffect, useRef, useState } from "react";
import type { ExtractCandidate } from "@collector/api";
import type { AlertsApi } from "../components/alerts/alert-store";
import {
  ITEM_IMPORT_ERROR_ID,
  ITEM_IMPORT_NOTHING_MESSAGE,
  peekItemImportCandidates,
  resolveItemImportAction,
  runItemImport,
} from "../lib/item-actions";

export type UseItemImportFlowInput = {
  itemId: string | null | undefined;
  alerts: AlertsApi;
  onDone?: () => void;
};

export function useItemImportFlow({
  itemId,
  alerts,
  onDone,
}: UseItemImportFlowInput) {
  const [importOpen, setImportOpen] = useState(false);
  const [importCandidates, setImportCandidates] = useState<ExtractCandidate[]>(
    [],
  );
  const [importAvailable, setImportAvailable] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const peekSeq = useRef(0);

  useEffect(() => {
    peekSeq.current += 1;
    setImportOpen(false);
    setImportBusy(false);
    setImportAvailable(false);
    setImportCandidates([]);
  }, [itemId]);

  const refreshImportAvailability = async () => {
    if (!itemId) {
      setImportAvailable(false);
      setImportCandidates([]);
      return;
    }
    const seq = ++peekSeq.current;
    const candidates = await peekItemImportCandidates(itemId);
    if (seq !== peekSeq.current) {
      return;
    }
    setImportCandidates(candidates);
    setImportAvailable(candidates.length > 0);
  };

  const runImport = async (candidate: ExtractCandidate) => {
    if (!itemId) {
      return;
    }
    const importItemId = itemId;
    setImportBusy(true);
    const updated = await runItemImport(alerts, importItemId, candidate);
    setImportBusy(false);
    if (updated === undefined) {
      return;
    }
    if (importItemId !== itemId) {
      return;
    }
    setImportOpen(false);
    setImportCandidates([]);
    setImportAvailable(false);
    onDone?.();
  };

  const handleImport = async () => {
    if (!itemId) {
      return;
    }
    let candidates = importCandidates;
    if (candidates.length === 0) {
      const seq = ++peekSeq.current;
      candidates = await peekItemImportCandidates(itemId);
      if (seq !== peekSeq.current) {
        return;
      }
      setImportCandidates(candidates);
      setImportAvailable(candidates.length > 0);
    }
    const action = resolveItemImportAction(candidates);
    if (action.kind === "none") {
      alerts.upsert(ITEM_IMPORT_ERROR_ID, {
        tone: "danger",
        message: ITEM_IMPORT_NOTHING_MESSAGE,
      });
      return;
    }
    if (action.kind === "one") {
      await runImport(action.candidate);
      return;
    }
    setImportOpen(true);
  };

  return {
    importOpen,
    setImportOpen,
    importCandidates,
    importAvailable,
    importBusy,
    refreshImportAvailability,
    handleImport,
    runImport,
  };
}
