export type ItemDetailMode = "view" | "form" | "source";

export type ItemChromeBreadcrumbState =
  | { status: "loading" }
  | {
      status: "ready";
      folderPath: string;
      title: string;
      idCopyFeedback: "copied" | "failed" | null;
      copyReady: boolean;
      isSaving: boolean;
      onCopyId: () => void;
    };

export type ItemChromeDomain = {
  status: "loading" | "ready" | "error";
  item: { id: string; title: string; folder_path: string } | null;
  mode: ItemDetailMode;
  idCopyFeedback: "copied" | "failed" | null;
  isSaving: boolean;
  isDeleting: boolean;
  onCopyId: () => void;
  onView: () => void;
  onForm: () => void;
  onSource: () => void;
  onRename: () => void;
  onDelete: () => void;
};
