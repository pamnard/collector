import type { ExtractCandidate } from "@collector/api";
import { formatImportCandidateLabel } from "../../lib/item-actions";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export interface ItemExtractDialogProps {
  open: boolean;
  candidates: readonly ExtractCandidate[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (candidate: ExtractCandidate) => void;
}

export function ItemExtractDialog({
  open,
  candidates,
  busy,
  onOpenChange,
  onConfirm,
}: ItemExtractDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Импорт</DialogTitle>
          <DialogDescription>
            Выберите, что скачать в эту заметку.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <li key={`${candidate.extractorId}:${candidate.url}`}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                disabled={busy}
                onClick={() => {
                  onConfirm(candidate);
                }}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">
                    {formatImportCandidateLabel(candidate)}
                  </span>
                  <span className="text-xs text-muted-foreground break-all">
                    {candidate.url}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
