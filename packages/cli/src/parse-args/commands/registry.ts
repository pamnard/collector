import type { CliCommand } from "../types.js";
import { unionFlagSets } from "../helpers.js";
import { parseHealth, parseSearch } from "./health-search.js";
import {
  CREATE_ITEM_FLAGS,
  IMPORT_FOLDER_FLAGS,
  MOVE_ITEM_FLAGS,
  UPDATE_ITEM_FLAGS,
  UPDATE_ITEM_SOURCE_FLAGS,
  WAIT_DERIVED_FLAGS,
  parseCreateItem,
  parseDeleteItem,
  parseGetItem,
  parseGetItemSource,
  parseImportFolder,
  parseMoveItem,
  parseUpdateItem,
  parseUpdateItemSource,
  parseWaitDerived,
} from "./items.js";
import {
  LIST_FOLDER_ITEMS_FLAGS,
  parseCreateFolder,
  parseDeleteFolder,
  parseListFolderItems,
  parseListFolders,
  parseMoveFolder,
  parseRenameFolder,
} from "./folders.js";
import {
  ATTACH_MEDIA_FLAGS,
  REPLACE_MEDIA_FLAGS,
  parseAttachMedia,
  parseDeleteMedia,
  parseListItemMedia,
  parseReplaceMedia,
  parseSetItemCover,
} from "./media.js";
import {
  EXTRACT_ITEM_CANDIDATE_FLAGS,
  parseDiscoverExtractCandidates,
  parseExtractItemCandidate,
} from "./extract.js";

export type CommandParser = (argv: string[], rest: string[]) => CliCommand;

export const ALL_COMMAND_FLAGS = unionFlagSets(
  CREATE_ITEM_FLAGS,
  UPDATE_ITEM_FLAGS,
  UPDATE_ITEM_SOURCE_FLAGS,
  MOVE_ITEM_FLAGS,
  IMPORT_FOLDER_FLAGS,
  WAIT_DERIVED_FLAGS,
  LIST_FOLDER_ITEMS_FLAGS,
  ATTACH_MEDIA_FLAGS,
  REPLACE_MEDIA_FLAGS,
  EXTRACT_ITEM_CANDIDATE_FLAGS,
);

/** Literal keys stay aligned with `COMMAND_USAGE` / help output. */
export const COMMAND_PARSERS = {
  health: parseHealth,
  search: parseSearch,
  "get-item": parseGetItem,
  "get-item-source": parseGetItemSource,
  "create-item": parseCreateItem,
  "update-item": parseUpdateItem,
  "update-item-source": parseUpdateItemSource,
  "delete-item": parseDeleteItem,
  "import-folder": parseImportFolder,
  "wait-derived": parseWaitDerived,
  "create-folder": parseCreateFolder,
  "list-folders": parseListFolders,
  "list-folder-items": parseListFolderItems,
  "rename-folder": parseRenameFolder,
  "move-folder": parseMoveFolder,
  "delete-folder": parseDeleteFolder,
  "move-item": parseMoveItem,
  "list-item-media": parseListItemMedia,
  "attach-media": parseAttachMedia,
  "replace-media": parseReplaceMedia,
  "delete-media": parseDeleteMedia,
  "set-item-cover": parseSetItemCover,
  "discover-extract-candidates": parseDiscoverExtractCandidates,
  "extract-item-candidate": parseExtractItemCandidate,
} satisfies Record<string, CommandParser>;

export type RegisteredCommandName = keyof typeof COMMAND_PARSERS;

export function isRegisteredCommand(
  name: string,
): name is RegisteredCommandName {
  return Object.prototype.hasOwnProperty.call(COMMAND_PARSERS, name);
}

export function getCommandParser(name: string): CommandParser | undefined {
  if (!isRegisteredCommand(name)) {
    return undefined;
  }
  return COMMAND_PARSERS[name];
}
