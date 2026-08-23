import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import type { ItemDetailMode } from "../../components/layout/item-chrome";
import type { ItemFormValues } from "../../types/item";

/** Grouped writers for save orchestration and mode transitions. */
export type ItemDetailSaveSink = {
  setFormValues: Dispatch<SetStateAction<ItemFormValues | null>>;
  setItem: Dispatch<SetStateAction<ItemFile | null>>;
  setContent: Dispatch<SetStateAction<string | null>>;
  setItemTagNames: Dispatch<SetStateAction<string[]>>;
  setSourceText: Dispatch<SetStateAction<string | null>>;
  setSourceBaseline: Dispatch<SetStateAction<string | null>>;
  setMode: Dispatch<SetStateAction<ItemDetailMode>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setError: (message: string | null) => void;
  navigate: NavigateFunction;
};

/** Read-side values for save orchestration (not setters). */
export type ItemDetailSaveSnapshot = {
  id: string | undefined;
  item: ItemFile | null;
  content: string | null;
  formValues: ItemFormValues | null;
  itemTagNames: string[];
  sourceText: string | null;
  sourceBaseline: string | null;
  mode: ItemDetailMode;
  isSaving: boolean;
};
