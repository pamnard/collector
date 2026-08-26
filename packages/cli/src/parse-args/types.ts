import type { ContentType } from "@collector/shared";

export type CliCommand =
  | { name: "health" }
  | { name: "search"; query: string }
  | { name: "get-item"; itemId: string }
  | { name: "get-item-source"; itemId: string }
  | {
      name: "create-item";
      title: string;
      content_type: ContentType;
      description?: string;
      url?: string | null;
      content?: string | null;
      folder_path?: string;
    }
  | {
      name: "update-item";
      itemId: string;
      title?: string;
      description?: string;
      url?: string | null;
      content?: string | null;
      content_type?: ContentType;
      tags?: string[];
      folder_path?: string;
    }
  | {
      name: "update-item-source";
      itemId: string;
      rawMarkdown: string;
    }
  | { name: "delete-item"; itemId: string }
  | {
      name: "import-folder";
      sourceDirAbs: string;
      folder_path?: string;
      wait: boolean;
    }
  | {
      name: "wait-derived";
      itemId: string;
      contentRevision: number;
      timeoutMs?: number;
    }
  | { name: "create-tag"; tagName: string; color?: string | null }
  | { name: "delete-tag"; tagId: string }
  | { name: "create-folder"; folderPath: string }
  | { name: "list-folders" }
  | { name: "rename-folder"; oldPath: string; newPath: string }
  | { name: "move-folder"; oldPath: string; newPath: string }
  | { name: "delete-folder"; folderPath: string }
  | { name: "move-item"; itemId: string; folderPath: string }
  | { name: "list-item-media"; itemId: string }
  | {
      name: "attach-media";
      itemId: string;
      filePath: string;
      filename?: string;
    }
  | {
      name: "replace-media";
      itemId: string;
      mediaId: string;
      filePath: string;
      filename?: string;
    }
  | { name: "delete-media"; itemId: string; mediaId: string }
  | { name: "set-item-cover"; itemId: string; mediaId: string }
  | { name: "discover-extract-candidates"; itemId: string }
  | {
      name: "extract-item-candidate";
      itemId: string;
      extractorId: string;
      url: string;
      meta?: Record<string, string>;
    };

export interface ParsedCliArgs {
  command: CliCommand;
  /** Optional at parse time; resolveCliHostEndpoint fills from data-dir file when omitted. */
  baseUrl?: string;
  dataDir?: string;
  token?: string;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}
