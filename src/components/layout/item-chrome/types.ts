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

/** Ready-item stub published into item chrome (header / bottom chrome). */
export type ItemChromeItemRef = {
  id: string;
  title: string;
  folder_path: string;
};

export type ItemChromeDomain = {
  status: "loading" | "ready" | "error";
  item: ItemChromeItemRef | null;
  mode: ItemDetailMode;
  idCopyFeedback: "copied" | "failed" | null;
  isSaving: boolean;
  isDeleting: boolean;
  onCopyId: () => void;
  onView: () => void;
  onForm: () => void;
  onSource: () => void;
  onMove: () => void;
  onRename: () => void;
  onLint: () => void;
  onDelete: () => void;
};
