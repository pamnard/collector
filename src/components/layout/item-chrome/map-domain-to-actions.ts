import type { ItemHeaderActionsModel } from "../ItemHeaderActions";
import type { ItemChromeBreadcrumbState, ItemChromeDomain } from "./types";

export function mapDomainToBreadcrumbs(
  domain: ItemChromeDomain | null,
): ItemChromeBreadcrumbState | null {
  if (domain === null) {
    return null;
  }
  if (domain.status === "loading") {
    return { status: "loading" };
  }
  const copyFields = {
    idCopyFeedback: domain.idCopyFeedback,
    copyReady: domain.item !== null,
    isSaving: domain.isSaving,
    onCopyId: domain.onCopyId,
  };
  if (domain.item !== null) {
    return {
      status: "ready",
      folderPath: domain.item.folder_path,
      title: domain.item.title,
      ...copyFields,
    };
  }
  return { status: "ready", folderPath: "", title: "", ...copyFields };
}

export function mapDomainToActions(
  domain: ItemChromeDomain | null,
): ItemHeaderActionsModel | null {
  if (domain === null) {
    return null;
  }
  return {
    mode: domain.mode,
    isSaving: domain.isSaving,
    isDeleting: domain.isDeleting,
    ready: domain.item !== null,
    onView: domain.onView,
    onForm: domain.onForm,
    onSource: domain.onSource,
    onRename: domain.onRename,
    onDelete: domain.onDelete,
  };
}
