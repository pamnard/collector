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
  if (domain.item !== null) {
    return {
      status: "ready",
      folderPath: domain.item.folder_path,
      title: domain.item.title,
    };
  }
  return { status: "ready", folderPath: "", title: "" };
}

export function mapDomainToActions(
  domain: ItemChromeDomain | null,
): ItemHeaderActionsModel | null {
  if (domain === null) {
    return null;
  }
  return {
    mode: domain.mode,
    idCopyFeedback: domain.idCopyFeedback,
    isSaving: domain.isSaving,
    isDeleting: domain.isDeleting,
    ready: domain.item !== null,
    onCopyId: domain.onCopyId,
    onView: domain.onView,
    onForm: domain.onForm,
    onSource: domain.onSource,
    onDelete: domain.onDelete,
  };
}
