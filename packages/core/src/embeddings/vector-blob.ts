/** Pack a float32 vector into bytes for SQLite BLOB storage (browser-safe). */
export function vectorToBlob(vector: Float32Array): Uint8Array {
  const out = new Uint8Array(vector.byteLength);
  out.set(
    new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
  );
  return out;
}

/** Unpack a SQLite BLOB into a Float32Array (copy — safe if the blob is pooled). */
export function blobToVector(blob: Uint8Array): Float32Array {
  if (blob.byteLength % 4 !== 0) {
    throw new Error(
      `item embedding blob length ${blob.byteLength} is not a multiple of 4`,
    );
  }
  const copy = new ArrayBuffer(blob.byteLength);
  new Uint8Array(copy).set(blob);
  return new Float32Array(copy);
}
