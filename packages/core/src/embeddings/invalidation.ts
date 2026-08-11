import { sha1Bytes } from "../util/sha1.js";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Stable fingerprint of the exact string sent to the embedding model. */
export function fingerprintEmbedText(text: string): string {
  return bytesToHex(sha1Bytes([new TextEncoder().encode(text)]));
}

export type EmbeddingIdentity = {
  modelId: string;
  contentRevision: number;
  inputFingerprint: string;
};

export function needsRecompute(
  stored: EmbeddingIdentity | null,
  current: EmbeddingIdentity,
): boolean {
  if (stored === null) {
    return true;
  }
  return (
    stored.modelId !== current.modelId ||
    stored.contentRevision !== current.contentRevision ||
    stored.inputFingerprint !== current.inputFingerprint
  );
}
