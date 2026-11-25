// MD5 (RFC 1321), by which medrec's views.json names the files a view was made
// from. A browser's own digests leave it out. It tells one file of the folder
// from another; nothing is kept secret or signed by it.

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const SINES = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

/** The MD5 of these bytes, in lower-case hex. */
export function md5(bytes: Uint8Array): string {
  // One bit, zeros, and the length in bits, to a whole number of 64-byte blocks.
  const padded = new Uint8Array((((bytes.length + 8) >>> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 2 ** 29), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const words = new Uint32Array(16);
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(at + i * 4, true);
    let [a, b, c, d] = state as [number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const mix = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = words[(round === 0 ? i : round === 1 ? 5 * i + 1 : round === 2 ? 3 * i + 5 : 7 * i) % 16]!;
      const sum = (a + mix + SINES[i]! + word) | 0;
      const by = SHIFTS[round * 4 + (i & 3)]!;
      [a, d, c, b] = [d, c, b, (b + ((sum << by) | (sum >>> (32 - by)))) | 0];
    }
    [a, b, c, d].forEach((x, i) => (state[i] = (state[i]! + x) | 0));
  }
  const out = new DataView(new ArrayBuffer(16));
  state.forEach((x, i) => out.setUint32(i * 4, x >>> 0, true));
  return [...new Uint8Array(out.buffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
