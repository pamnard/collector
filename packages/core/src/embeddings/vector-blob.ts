/** Pack a float32 vector into a Buffer for SQLite BLOB storage. */
export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(
    vector.buffer,
    vector.byteOffset,
    vector.byteLength,
  );
}

/** Unpack a SQLite BLOB into a Float32Array (one copy — safe if Buffer is pooled). */
export function blobToVector(blob: Buffer | Uint8Array): Float32Array {
  const src = blob instanceof Buffer ? blob : Buffer.from(blob);
  if (src.byteLength % 4 !== 0) {
    throw new Error(
      `item embedding blob length ${src.byteLength} is not a multiple of 4`,
    );
  }
  const copy = new ArrayBuffer(src.byteLength);
  new Uint8Array(copy).set(src);
  return new Float32Array(copy);
}
