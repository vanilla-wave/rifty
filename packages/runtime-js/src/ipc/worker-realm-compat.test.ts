/**
 * Realm-compat shims (worker-realm-compat.ts).
 *
 * The TextDecoder shim is patched UNCONDITIONALLY (a feature-detect probe is not
 * representative of emnapi's real shared decode, so it false-negatives). The
 * copy-into-private-buffer path is the load-bearing bit: without it the realm
 * that rejects shared views throws and crashes the emnapi pthread. We exercise
 * that path with an injected decoder whose `decode` rejects shared views,
 * simulating older Chromium (the realm we can't reproduce in Node).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  installSharedMemoryTolerantTextDecoder,
  installWritableSelf,
} from './worker-realm-compat.ts';

/** A decoder whose `decode` throws on a shared-backed view (older-Chromium
 * contract Node lacks) but decodes a private view via the real TextDecoder. */
function makeRejectingDecoder(): typeof TextDecoder {
  const real = new TextDecoder();
  class RejectingDecoder {
    decode(input?: unknown, opts?: unknown): string {
      const view = ArrayBuffer.isView(input) ? input : undefined;
      const shared =
        (view && view.buffer instanceof SharedArrayBuffer) || input instanceof SharedArrayBuffer;
      if (shared) throw new TypeError("Failed to execute 'decode': value must not be shared.");
      return real.decode(input as Uint8Array, opts as TextDecodeOptions);
    }
  }
  return RejectingDecoder as unknown as typeof TextDecoder;
}

describe('installSharedMemoryTolerantTextDecoder (unconditional shared-buffer copy)', () => {
  it('patches decode so a shared-backed view is copied instead of throwing', () => {
    const Dec = makeRejectingDecoder();
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(5));
    sharedBytes.set([104, 101, 108, 108, 111]); // "hello"

    // Before the patch: the rejecting decoder throws on a shared view.
    expect(() => new Dec().decode(sharedBytes)).toThrow(/must not be shared/);

    expect(installSharedMemoryTolerantTextDecoder(Dec)).toBe(true);

    // After: it copies into a private buffer first → decodes to the same bytes.
    expect(new Dec().decode(sharedBytes)).toBe('hello');
  });

  it('passes a non-shared view straight through (no needless copy semantics change)', () => {
    const Dec = makeRejectingDecoder();
    installSharedMemoryTolerantTextDecoder(Dec);
    const priv = new TextEncoder().encode('plain');
    expect(new Dec().decode(priv)).toBe('plain');
  });

  it('is idempotent — a second install on the same decoder is a no-op', () => {
    const Dec = makeRejectingDecoder();
    expect(installSharedMemoryTolerantTextDecoder(Dec)).toBe(true);
    expect(installSharedMemoryTolerantTextDecoder(Dec)).toBe(false);
  });
});

describe('installWritableSelf', () => {
  const hadSelf = 'self' in globalThis;
  const savedSelf = (globalThis as { self?: unknown }).self;
  afterEach(() => {
    if (hadSelf) {
      Object.defineProperty(globalThis, 'self', {
        value: savedSelf,
        writable: true,
        configurable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'self');
    }
  });

  it('installs a writable self === globalThis (assignment is a harmless no-op)', () => {
    installWritableSelf();
    expect((globalThis as { self?: unknown }).self).toBe(globalThis);
    // emnapi's `globalThis.self = globalThis` must not throw after this.
    expect(() => {
      (globalThis as { self?: unknown }).self = globalThis;
    }).not.toThrow();
  });
});
