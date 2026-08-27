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
  buildTagDisplayNames,
  sameTagName,
  toggleTagSelection,
} from "./tag-picker-helpers";

export const TAG_PICKER_ERROR_ID = "tag-picker-error";

/**
 * Tag picker assigns names on the current item only (#842).
 * Catalog create/rename/delete is not supported — lists come from documents.
 */
export function useTagPicker(args: {
  selectedTagNames: string[];
  onChange: (tagNames: string[]) => void;
}) {
  const { selectedTagNames, onChange } = args;
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([TAG_PICKER_ERROR_ID]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [newTagName, setNewTagName] = useState("");

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
    () =>
      buildTagDisplayNames(
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

  const findKnownTag = (name: string): TagWithCount | undefined =>
    tags.find((tag) => sameTagName(tag.name, name));

  const isSelected = (name: string): boolean =>
    selectedTagNames.some((selected) => sameTagName(selected, name));

  return {
    tags,
    displayNames,
    newTagName,
    setNewTagName,
    toggleTag,
    handleAddTagName,
    findKnownTag,
    isSelected,
  };
}
