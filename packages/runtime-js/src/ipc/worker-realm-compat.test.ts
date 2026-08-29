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
  installWorkerRealmCompat,
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

/** SharedArrayBuffer(10): 0xFF sentinels everywhere except 'hello' at [3,8). */
function makeSentinelSab(): { sab: SharedArrayBuffer; view: Uint8Array; dataView: DataView } {
  const sab = new SharedArrayBuffer(10);
  const all = new Uint8Array(sab);
  all.fill(0xff);
  all.set([104, 101, 108, 108, 111], 3); // 'hello'
  return { sab, view: new Uint8Array(sab, 3, 5), dataView: new DataView(sab, 3, 5) };
}

/** A decoder recording the EXACT argument objects of every call (parity 9). */
function makeSpyDecoder(): {
  Dec: typeof TextDecoder;
  calls: { input: unknown; opts: unknown }[];
} {
  const calls: { input: unknown; opts: unknown }[] = [];
  class SpyDecoder {
    decode(...args: unknown[]): string {
      calls.push({ input: args[0], opts: args[1] });
      return 'spy';
    }
  }
  return { Dec: SpyDecoder as unknown as typeof TextDecoder, calls };
}

describe('COI-realm exactness pins — parity 8 (offset/length against sentinel bytes)', () => {
  // The copy path must decode EXACTLY the view's bytes: a copy that ignores
  // byteOffset/byteLength decodes sentinels (U+FFFD) and fails these.
  it('shared Uint8Array at nonzero offset decodes only the view bytes, sentinels never included', () => {
    const Dec = makeRejectingDecoder();
    installSharedMemoryTolerantTextDecoder(Dec);
    const { view } = makeSentinelSab();
    expect(new Dec().decode(view)).toBe('hello');
  });

  it('DataView over a shared buffer at nonzero offset decodes only the view bytes', () => {
    const Dec = makeRejectingDecoder();
    installSharedMemoryTolerantTextDecoder(Dec);
    const { dataView } = makeSentinelSab();
    expect(new Dec().decode(dataView)).toBe('hello');
  });

  it('raw SharedArrayBuffer decodes the WHOLE buffer exactly (sentinels included, positions exact)', () => {
    const Dec = makeRejectingDecoder();
    installSharedMemoryTolerantTextDecoder(Dec);
    const { sab } = makeSentinelSab();
    expect(new Dec().decode(sab)).toBe(`${'�'.repeat(3)}hello${'�'.repeat(2)}`);
  });
});

describe('COI-realm identity pins — parity 9 (exact input/opts objects, exact thrown error)', () => {
  it('non-shared typed view / DataView / ArrayBuffer / no-arg pass the EXACT input and opts objects', () => {
    const { Dec, calls } = makeSpyDecoder();
    installSharedMemoryTolerantTextDecoder(Dec);
    const d = new Dec();
    const opts = { stream: true };
    const view = new Uint8Array([1, 2, 3]);
    const dataView = new DataView(new ArrayBuffer(4));
    const buf = new ArrayBuffer(2);

    d.decode(view, opts);
    expect(calls.at(-1)?.input).toBe(view);
    expect(calls.at(-1)?.opts).toBe(opts);
    d.decode(dataView, opts);
    expect(calls.at(-1)?.input).toBe(dataView);
    expect(calls.at(-1)?.opts).toBe(opts);
    d.decode(buf, opts);
    expect(calls.at(-1)?.input).toBe(buf);
    expect(calls.at(-1)?.opts).toBe(opts);
    d.decode();
    expect(calls.at(-1)?.input).toBeUndefined();
    expect(calls.at(-1)?.opts).toBeUndefined();
  });

  it('a sentinel error thrown by the decoder propagates as the SAME object (non-shared AND shared post-copy)', () => {
    const sentinel = new Error('sentinel');
    class ThrowingDecoder {
      decode(): string {
        throw sentinel;
      }
    }
    const Dec = ThrowingDecoder as unknown as typeof TextDecoder;
    installSharedMemoryTolerantTextDecoder(Dec);
    const d = new Dec();
    const { view } = makeSentinelSab();
    let caught: unknown;
    try {
      d.decode(new Uint8Array([1]));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(sentinel);
    caught = undefined;
    try {
      d.decode(view); // shared path: error thrown AFTER the copy must still be the same object
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(sentinel);
  });
});

describe('repeat-install identity pins — parity 7 (booleans alone do not close this)', () => {
  it('direct repeat: false AND proto.decode strictly === the first patched fn AND shared decode still green', () => {
    const Dec = makeRejectingDecoder();
    expect(installSharedMemoryTolerantTextDecoder(Dec)).toBe(true);
    const first = (Dec.prototype as { decode: unknown }).decode;
    expect((first as { __riftyShared?: boolean }).__riftyShared).toBe(true);
    expect(installSharedMemoryTolerantTextDecoder(Dec)).toBe(false);
    expect((Dec.prototype as { decode: unknown }).decode).toBe(first);
    const { view } = makeSentinelSab();
    expect(new Dec().decode(view)).toBe('hello');
  });

  it('aggregate repeat (installWorkerRealmCompat twice): same identity pins on the realm decoder', () => {
    const realDecode = TextDecoder.prototype.decode;
    const hadSelf = 'self' in globalThis;
    const savedSelf = (globalThis as { self?: unknown }).self;
    try {
      installWorkerRealmCompat();
      // Call-ONE sibling snapshot (observable-order): every sibling effect is
      // present after the FIRST aggregate call, before any repeat.
      const first = TextDecoder.prototype.decode;
      expect((first as { __riftyShared?: boolean }).__riftyShared).toBe(true);
      expect((globalThis as { global?: unknown }).global).toBe(globalThis);
      expect((globalThis as { self?: unknown }).self).toBe(globalThis); // pre-write value
      expect(Object.hasOwn(globalThis, 'self')).toBe(true);
      const selfDesc = Object.getOwnPropertyDescriptor(globalThis, 'self');
      expect(selfDesc !== undefined && 'value' in selfDesc && selfDesc.writable).toBe(true);
      installWorkerRealmCompat();
      expect(TextDecoder.prototype.decode).toBe(first);
      expect(installSharedMemoryTolerantTextDecoder()).toBe(false);
      const { view } = makeSentinelSab();
      expect(new TextDecoder().decode(view)).toBe('hello');
    } finally {
      TextDecoder.prototype.decode = realDecode;
      if (hadSelf) {
        Object.defineProperty(globalThis, 'self', {
          value: savedSelf,
          writable: true,
          configurable: true,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'self');
      }
    }
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

  it('installs an OWN writable data self === globalThis (assignment is a harmless no-op)', () => {
    installWritableSelf();
    // Pre-write value + ownership + descriptor BEFORE any assignment: a null
    // value or an inherited setter must fail here, not be masked by the write.
    expect((globalThis as { self?: unknown }).self).toBe(globalThis);
    expect(Object.hasOwn(globalThis, 'self')).toBe(true);
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'self');
    expect(desc !== undefined && 'value' in desc && desc.writable).toBe(true);
    // emnapi's `globalThis.self = globalThis` must not throw after this.
    expect(() => {
      (globalThis as { self?: unknown }).self = globalThis;
    }).not.toThrow();
    expect((globalThis as { self?: unknown }).self).toBe(globalThis);
  });
});
