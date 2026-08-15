import type { AttachMediaFileInput, ImportDroppedFilesInput } from "@collector/api";
import { badRequest } from "../handlers/params.js";

export function requireFileName(
  row: Record<string, unknown>,
  label: string,
  method: string,
): string {
  if (typeof row.name === "string" && row.name.length > 0) {
    return row.name;
  }
  if (typeof row.filename === "string" && row.filename.length > 0) {
    return row.filename;
  }
  badRequest(`${method}: ${label} name or filename required`);
}

export function decodeDroppedFiles(
  files: unknown,
  method: string,
): ImportDroppedFilesInput["files"] {
  if (!Array.isArray(files)) {
    badRequest(`${method}: files array required`);
  }
  return files.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      badRequest(`${method}: files[${index}] object required`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.relativePath !== "string" || !r.relativePath) {
      badRequest(`${method}: files[${index}].relativePath required`);
    }
    const name = requireFileName(r, `files[${index}]`, method);
    if (typeof r.dataBase64 !== "string") {
      badRequest(`${method}: files[${index}].dataBase64 required`);
    }
    return {
      relativePath: r.relativePath,
      name,
      bytes: Uint8Array.from(Buffer.from(r.dataBase64, "base64")),
    };
  });
}

export function decodeMediaFiles(
  value: unknown,
  method: string,
): AttachMediaFileInput[] {
  if (!Array.isArray(value)) {
    badRequest(`${method}: files must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      badRequest(`${method}: files[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const name = requireFileName(row, `files[${index}]`, method);
    if (typeof row.dataBase64 !== "string") {
      badRequest(`${method}: files[${index}].dataBase64 must be a string`);
    }
    return {
      name,
      bytes: Uint8Array.from(Buffer.from(row.dataBase64, "base64")),
    };
  });
}
