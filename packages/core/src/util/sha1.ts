/**
 * Sync SHA-1 for isomorphic use (browser + Node). Avoids `node:crypto`
 * so Vite can load vault helpers in the web stand.
 */
export function sha1Bytes(parts: Uint8Array[]): Uint8Array {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  let totalLen = 0;
  for (const part of parts) {
    totalLen += part.length;
  }
  const bitLenHi = Math.floor(totalLen / 0x20000000);
  const bitLenLo = (totalLen << 3) >>> 0;

  const withPadding = totalLen + 1 + ((55 - totalLen) % 64) + 8;
  const msg = new Uint8Array(withPadding);
  let offset = 0;
  for (const part of parts) {
    msg.set(part, offset);
    offset += part.length;
  }
  msg[offset] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(withPadding - 8, bitLenHi, false);
  view.setUint32(withPadding - 4, bitLenLo, false);

  const w = new Int32Array(80);
  for (let i = 0; i < withPadding; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      w[j] = view.getInt32(i + j * 4, false);
    }
    for (let j = 16; j < 80; j += 1) {
      const x = w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!;
      w[j] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j += 1) {
      let f: number;
      let k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[j]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}
