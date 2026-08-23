import { useEffect, useMemo, useState } from "react";
import type { TagWithCount } from "@collector/core";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { errorMessage } from "../alerts/alert-store";
import { getCollectorService } from "../../services/collector-client";
import {
  applyAddTagName,
  applyTagRecordUpdate,
  buildTagDisplayNames,
  removeTagFromCatalog,
  removeTagFromSelection,
  renameTagInSelection,
  sameTagName,
  toggleTagSelection,
} from "./tag-picker-helpers";

export const TAG_PICKER_ERROR_ID = "tag-picker-error";

export function useTagPicker(args: {
  selectedTagNames: string[];
  onChange: (tagNames: string[]) => void;
}) {
  const { selectedTagNames, onChange } = args;
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([TAG_PICKER_ERROR_ID]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TagWithCount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingRename, setPendingRename] = useState<TagWithCount | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    getCollectorService()
      .tags.listTags()
      .then(setTags)
      .catch((err: unknown) => {
        alerts.upsert(TAG_PICKER_ERROR_ID, {
          tone: "danger",
          message: errorMessage(err),
        });
      });
  }, [alerts]);

  const displayNames = useMemo(
    () => buildTagDisplayNames(
      tags.map((tag) => tag.name),
      selectedTagNames,
    ),
    [tags, selectedTagNames],
  );

  const toggleTag = (name: string) => {
    onChange(toggleTagSelection(selectedTagNames, name));
  };

  const handleAddTagName = () => {
    if (applyAddTagName(selectedTagNames, newTagName, onChange)) {
      setNewTagName("");
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setIsDeleting(true);
    alerts.dismiss(TAG_PICKER_ERROR_ID);
    try {
      await getCollectorService().tags.deleteTag(pendingDelete.id);
      setTags((current) => removeTagFromCatalog(current, pendingDelete.id));
      onChange(removeTagFromSelection(selectedTagNames, pendingDelete.name));
    } catch (err: unknown) {
      alerts.upsert(TAG_PICKER_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const openRename = (tag: TagWithCount) => {
    setPendingRename(tag);
    setRenameValue(tag.name);
  };

  const handleConfirmRename = async () => {
    if (!pendingRename) {
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName || nextName === pendingRename.name) {
      setPendingRename(null);
      return;
    }

    setIsRenaming(true);
    alerts.dismiss(TAG_PICKER_ERROR_ID);
    try {
      const updated = await getCollectorService().tags.updateTagRecord(
        pendingRename.id,
        {
          name: nextName,
        },
      );
      setTags((current) =>
        applyTagRecordUpdate(current, pendingRename.id, updated),
      );
      onChange(
        renameTagInSelection(selectedTagNames, pendingRename.name, nextName),
      );
      setPendingRename(null);
    } catch (err: unknown) {
      alerts.upsert(TAG_PICKER_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
    } finally {
      setIsRenaming(false);
    }
  };

  const findKnownTag = (name: string): TagWithCount | undefined =>
    tags.find((tag) => sameTagName(tag.name, name));

  const isSelected = (name: string): boolean =>
    selectedTagNames.some((selected) => sameTagName(selected, name));

  return {
    tags,
    displayNames,
    newTagName,
    setNewTagName,
    pendingDelete,
    setPendingDelete,
    isDeleting,
    pendingRename,
    setPendingRename,
    renameValue,
    setRenameValue,
    isRenaming,
    toggleTag,
    handleAddTagName,
    handleConfirmDelete,
    openRename,
    handleConfirmRename,
    findKnownTag,
    isSelected,
  };
}
