import type { CliCommand } from "../types.js";
import { unionFlagSets } from "../helpers.js";
import { parseHealth, parseSearch } from "./health-search.js";
import {
  CREATE_ITEM_FLAGS,
  MOVE_ITEM_FLAGS,
  UPDATE_ITEM_FLAGS,
  UPDATE_ITEM_SOURCE_FLAGS,
  parseCreateItem,
  parseDeleteItem,
  parseGetItem,
  parseGetItemSource,
  parseMoveItem,
  parseUpdateItem,
  parseUpdateItemSource,
} from "./items.js";
import {
  CREATE_TAG_FLAGS,
  parseCreateTag,
  parseDeleteTag,
} from "./tags.js";
import {
  parseCreateFolder,
  parseDeleteFolder,
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

export type CommandParser = (argv: string[], rest: string[]) => CliCommand;

export const ALL_COMMAND_FLAGS = unionFlagSets(
  CREATE_ITEM_FLAGS,
  UPDATE_ITEM_FLAGS,
  UPDATE_ITEM_SOURCE_FLAGS,
  CREATE_TAG_FLAGS,
  MOVE_ITEM_FLAGS,
  ATTACH_MEDIA_FLAGS,
  REPLACE_MEDIA_FLAGS,
);

export const COMMAND_PARSERS: Record<string, CommandParser> = {
  health: parseHealth,
  search: parseSearch,
  "get-item": parseGetItem,
  "get-item-source": parseGetItemSource,
  "create-item": parseCreateItem,
  "update-item": parseUpdateItem,
  "update-item-source": parseUpdateItemSource,
  "delete-item": parseDeleteItem,
  "create-tag": parseCreateTag,
  "delete-tag": parseDeleteTag,
  "create-folder": parseCreateFolder,
  "list-folders": parseListFolders,
  "rename-folder": parseRenameFolder,
  "move-folder": parseMoveFolder,
  "delete-folder": parseDeleteFolder,
  "move-item": parseMoveItem,
  "list-item-media": parseListItemMedia,
  "attach-media": parseAttachMedia,
  "replace-media": parseReplaceMedia,
  "delete-media": parseDeleteMedia,
  "set-item-cover": parseSetItemCover,
};
