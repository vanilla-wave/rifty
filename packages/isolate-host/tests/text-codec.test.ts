/**
 * Differential suite (ADR-0557 §5): the guest's UTF-8 TextEncoder/TextDecoder
 * against Node's own on the same inputs.
 */
import { describe, expect, it } from 'vitest';
import { TextDecoder as GuestDecoder, TextEncoder as GuestEncoder } from '../src/guest/text-codec.ts';

// Deterministic PRNG so a failure reproduces.
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Bytes biased toward UTF-8 edge structure: leads, continuations, boundaries. */
function randomBytes(rand: () => number, n: number): Uint8Array {
  const pool = [0x00, 0x41, 0x7f, 0x80, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0x9f, 0xa0, 0x8f, 0x90];
  return Uint8Array.from({ length: n }, () =>
    rand() < 0.6 ? (pool[Math.floor(rand() * pool.length)] as number) : Math.floor(rand() * 256),
  );
}

describe('guest UTF-8 codec vs Node', () => {
  it('decode matches on 4000 random byte strings, one-shot and streamed in random chunks', () => {
    const rand = prng(1);
    for (let i = 0; i < 4000; i++) {
      const bytes = randomBytes(rand, Math.floor(rand() * 24));
      expect(new GuestDecoder().decode(bytes)).toBe(new TextDecoder().decode(bytes));
      const g = new GuestDecoder();
      const n = new TextDecoder();
      let gs = '';
      let ns = '';
      for (let at = 0; at < bytes.length; ) {
        const step = 1 + Math.floor(rand() * 4);
        const chunk = bytes.subarray(at, at + step);
        gs += g.decode(chunk, { stream: true });
        ns += n.decode(chunk, { stream: true });
        at += step;
      }
      expect(gs + g.decode()).toBe(ns + n.decode());
    }
  });

  it('fatal mode throws exactly when Node throws', () => {
    const rand = prng(2);
    for (let i = 0; i < 2000; i++) {
      const bytes = randomBytes(rand, Math.floor(rand() * 12));
      let nodeError: unknown;
      let nodeOut: string | undefined;
      try {
        nodeOut = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) {
        nodeError = e;
      }
      if (nodeError === undefined) {
        expect(new GuestDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(nodeOut);
      } else {
        expect(() => new GuestDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow(
          (nodeError as Error).message,
        );
      }
    }
  });

  it('BOM handling matches (default strips once per stream, ignoreBOM keeps)', () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0xef, 0xbb, 0xbf]);
    expect(new GuestDecoder().decode(bom)).toBe(new TextDecoder().decode(bom));
    expect(new GuestDecoder('utf8', { ignoreBOM: true }).decode(bom)).toBe(
      new TextDecoder('utf8', { ignoreBOM: true }).decode(bom),
    );
  });

  it('encode and encodeInto match, lone surrogates included', () => {
    const rand = prng(3);
    const units = [0x41, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff, 0xe9];
    for (let i = 0; i < 2000; i++) {
      const s = String.fromCharCode(
        ...Array.from({ length: Math.floor(rand() * 10) }, () =>
          rand() < 0.5 ? (units[Math.floor(rand() * units.length)] as number) : Math.floor(rand() * 0x10000),
        ),
      );
      expect(Array.from(new GuestEncoder().encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
      const size = Math.floor(rand() * 12);
      const a = new Uint8Array(size);
      const b = new Uint8Array(size);
      expect(new GuestEncoder().encodeInto(s, a)).toEqual(new TextEncoder().encodeInto(s, b));
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
});
