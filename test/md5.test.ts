import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5 } from '../src/md5';

const of = (text: string) => md5(new TextEncoder().encode(text));

describe('md5', () => {
  it('gives RFC 1321’s own answers', () => {
    expect(['', 'a', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz', '12345678901234567890123456789012345678901234567890123456789012345678901234567890'].map(of)).toEqual([
      'd41d8cd98f00b204e9800998ecf8427e',
      '0cc175b9c0f1b6a831c399e269772661',
      '900150983cd24fb0d6963f7d28e17f72',
      'f96b697d7cb7938d525a2f31aaf161d0',
      'c3fcd3d76192e4007dfb496cca67e13b',
      '57edf4a22be3c955ac49da2e2107b67a',
    ]);
  });

  it('is Node’s at every length across a block, and of a long file', () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7919 + n * 31) & 0xff);
    for (const n of [...Array(200).keys(), 1 << 20, (1 << 20) + 57]) expect(md5(bytes(n)), String(n)).toBe(createHash('md5').update(bytes(n)).digest('hex'));
  });
});
