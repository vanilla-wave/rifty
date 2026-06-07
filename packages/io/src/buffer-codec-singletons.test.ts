/**
 * Perf-guard #1 (perf audit 2026-06-05): the utf8 encode/decode path reuses
 * module-level `UTF8_ENCODER`/`UTF8_DECODER` singletons rather than allocating a
 * fresh `TextEncoder`/`TextDecoder` per call. The singletons are module-private,
 * so we spy the GLOBAL constructors and assert ZERO construction during a burst.
 *
 * RED-on-revert: change the utf8 branches in `buffer-codec.ts` back to per-call
 * `new TextEncoder()` / `new TextDecoder()` and this goes red (delta == 2*N).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from './buffer-codec.ts';

describe('buffer-codec utf8 codec singletons (#1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a burst of utf8 encode+decode constructs ZERO new TextEncoder/TextDecoder', () => {
    // Count constructions of the real globals. The spies wrap the originals so
    // existing singletons (built at module load, BEFORE this spy) are untouched;
    // only constructions DURING the burst increment the counters.
    const RealEncoder = globalThis.TextEncoder;
    const RealDecoder = globalThis.TextDecoder;
    let encoderCtors = 0;
    let decoderCtors = 0;
    vi.spyOn(globalThis, 'TextEncoder').mockImplementation(
      (...args: ConstructorParameters<typeof TextEncoder>) => {
        encoderCtors++;
        return new RealEncoder(...args);
      },
    );
    vi.spyOn(globalThis, 'TextDecoder').mockImplementation(
      (...args: ConstructorParameters<typeof TextDecoder>) => {
        decoderCtors++;
        return new RealDecoder(...args);
      },
    );

    const before = encoderCtors + decoderCtors;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const bytes = encode(`hello-${i}-Ünïçødé`, 'utf8');
      const round = decode(bytes, 'utf8');
      // Sanity: the shared instances must still produce correct round-trips
      // (a non-fatal decoder, no {fatal:true}, would not throw on bad bytes).
      expect(round).toBe(`hello-${i}-Ünïçødé`);
    }
    const delta = encoderCtors + decoderCtors - before;

    // Singleton path: zero constructions in the burst. Per-call `new` => 2*N.
    expect(delta).toBe(0);
  });

  it('the shared decoder is NON-fatal: malformed utf8 bytes decode to U+FFFD, not a throw', () => {
    // 0xff is an invalid utf8 lead byte. A {fatal:true} decoder would throw;
    // the default (non-fatal) singleton substitutes the replacement char.
    expect(decode(new Uint8Array([0xff]), 'utf8')).toBe('�');
  });
});
