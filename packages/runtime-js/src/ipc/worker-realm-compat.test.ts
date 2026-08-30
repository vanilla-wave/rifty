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

/** A decoder recording the EXACT argument objects of every call and returning
 * a UNIQUE sentinel per call (parity 9 — returns must pass through unchanged). */
function makeSpyDecoder(): {
  Dec: typeof TextDecoder;
  calls: { input: unknown; opts: unknown }[];
} {
  const calls: { input: unknown; opts: unknown }[] = [];
  class SpyDecoder {
    decode(...args: unknown[]): string {
      calls.push({ input: args[0], opts: args[1] });
      return `spy-${calls.length}`;
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
  it('non-shared typed view / DataView / ArrayBuffer / no-arg pass the EXACT input and opts objects AND return the decoder sentinel unchanged', () => {
    const { Dec, calls } = makeSpyDecoder();
    installSharedMemoryTolerantTextDecoder(Dec);
    const d = new Dec();
    const opts = { stream: true };
    const view = new Uint8Array([1, 2, 3]);
    const dataView = new DataView(new ArrayBuffer(4));
    const buf = new ArrayBuffer(2);

    // Unique sentinel per call: a wrapper that hands the original the exact
    // objects then fabricates its own output fails the return assertions.
    expect(d.decode(view, opts)).toBe('spy-1');
    expect(calls.at(-1)?.input).toBe(view);
    expect(calls.at(-1)?.opts).toBe(opts);
    expect(d.decode(dataView, opts)).toBe('spy-2');
    expect(calls.at(-1)?.input).toBe(dataView);
    expect(calls.at(-1)?.opts).toBe(opts);
    expect(d.decode(buf, opts)).toBe('spy-3');
    expect(calls.at(-1)?.input).toBe(buf);
    expect(calls.at(-1)?.opts).toBe(opts);
    expect(d.decode()).toBe('spy-4');
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

/** Sharedness + bytes of whatever object reached the original decoder. */
function receivedShape(input: unknown): { shared: boolean; bytes: number[] } {
  if (ArrayBuffer.isView(input)) {
    return {
      shared: input.buffer instanceof SharedArrayBuffer,
      bytes: Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength)),
    };
  }
  if (input instanceof SharedArrayBuffer) {
    return { shared: true, bytes: Array.from(new Uint8Array(input)) };
  }
  if (input instanceof ArrayBuffer) {
    return { shared: false, bytes: Array.from(new Uint8Array(input)) };
  }
  throw new Error('unexpected original-decoder input');
}

describe('ordered exact-call log — parity 13 (original decoder invoked EXACTLY once per decode; only shared-source calls get a private copy)', () => {
  // Output and error-identity rows alone admit a try-native/catch/copy-retry
  // wrapper that invokes the ORIGINAL decoder on the shared input first. The
  // ordered log kills it — over the FULL declared class set (a SAB-present-only
  // shared-streaming or DataView/raw native-first branch must not slip past a
  // Uint8Array-only, stream:false sweep): one original call per decode, and
  // every call on a shared source carries a private copy with the exact bytes.
  const HELLO = [104, 101, 108, 108, 111];
  const SENTINEL_SAB_BYTES = [0xff, 0xff, 0xff, ...HELLO, 0xff, 0xff];

  interface SweepSources {
    priv: Uint8Array;
    privDataView: DataView;
    privArrayBuffer: ArrayBuffer;
    view: Uint8Array;
    dataView: DataView;
    sab: SharedArrayBuffer;
    stream1: Uint8Array;
    stream2: Uint8Array;
  }

  function makeSweepSources(): SweepSources {
    const { sab, view, dataView } = makeSentinelSab();
    const streamSab = new SharedArrayBuffer(2);
    new Uint8Array(streamSab).set([0xc3, 0xa9]); // 'é' split across two views
    return {
      priv: new TextEncoder().encode('plain'),
      privDataView: new DataView(new TextEncoder().encode('plain').buffer),
      privArrayBuffer: new TextEncoder().encode('plain').buffer,
      view,
      dataView,
      sab,
      stream1: new Uint8Array(streamSab, 0, 1),
      stream2: new Uint8Array(streamSab, 1, 1),
    };
  }

  function runSweep(
    d: TextDecoder,
    s: SweepSources,
    opts: object,
    streamOpts: object,
    finalOpts: object,
  ): string[] {
    return [
      d.decode(s.priv, opts),
      d.decode(s.privDataView, opts),
      d.decode(s.privArrayBuffer, opts),
      d.decode(),
      d.decode(s.view, opts),
      d.decode(s.dataView, opts),
      d.decode(s.sab as unknown as ArrayBuffer, opts),
      d.decode(s.stream1, streamOpts),
      d.decode(s.stream2, finalOpts),
    ];
  }

  function assertOrderedLog(
    log: { input: unknown; opts: unknown }[],
    returns: string[],
    s: SweepSources,
    opts: object,
    streamOpts: object,
    finalOpts: object,
  ): void {
    // EXACTLY one original call per decode, in order — no retry, no extra call.
    expect(log).toHaveLength(9);
    expect(returns).toEqual(Array.from({ length: 9 }, (_, i) => `ret-${i + 1}`));
    // Non-shared classes + no-arg: the EXACT source object straight through.
    const passRows: [number, unknown][] = [
      [0, s.priv],
      [1, s.privDataView],
      [2, s.privArrayBuffer],
    ];
    for (const [i, source] of passRows) {
      expect(log[i]?.input).toBe(source);
      expect(log[i]?.opts).toBe(opts);
    }
    expect(log[3]?.input).toBeUndefined();
    expect(log[3]?.opts).toBeUndefined();
    // Shared classes incl. STREAMING: never the source object, never
    // shared-backed, bytes exact, EXACT opts object per call.
    const sharedRows: [number, unknown, number[], object][] = [
      [4, s.view, HELLO, opts],
      [5, s.dataView, HELLO, opts],
      [6, s.sab, SENTINEL_SAB_BYTES, opts],
      [7, s.stream1, [0xc3], streamOpts],
      [8, s.stream2, [0xa9], finalOpts],
    ];
    for (const [i, source, bytes, rowOpts] of sharedRows) {
      const entry = log[i];
      expect(entry?.input).not.toBe(source);
      const shape = receivedShape(entry?.input);
      expect(shape.shared).toBe(false);
      expect(shape.bytes).toEqual(bytes);
      expect(entry?.opts).toBe(rowOpts);
    }
  }

  it('direct install: ordered log across priv view/DataView/ArrayBuffer, no-arg, shared view/DataView/raw SAB, streaming', () => {
    const log: { input: unknown; opts: unknown }[] = [];
    class LoggingDecoder {
      decode(...args: unknown[]): string {
        log.push({ input: args[0], opts: args[1] });
        return `ret-${log.length}`;
      }
    }
    const Dec = LoggingDecoder as unknown as typeof TextDecoder;
    installSharedMemoryTolerantTextDecoder(Dec);
    const s = makeSweepSources();
    const opts = { stream: false };
    const streamOpts = { stream: true };
    const finalOpts = { stream: false };
    const returns = runSweep(new Dec(), s, opts, streamOpts, finalOpts);
    assertOrderedLog(log, returns, s, opts, streamOpts, finalOpts);
  });

  it('aggregate install (installWorkerRealmCompat): same log through the realm TextDecoder', () => {
    const realDecode = TextDecoder.prototype.decode;
    const hadSelf = 'self' in globalThis;
    const savedSelf = (globalThis as { self?: unknown }).self;
    const log: { input: unknown; opts: unknown }[] = [];
    // The "original" the aggregate captures is this logging fn — every call
    // the patched realm decode makes lands in the ordered log.
    TextDecoder.prototype.decode = ((...args: unknown[]): string => {
      log.push({ input: args[0], opts: args[1] });
      return `ret-${log.length}`;
    }) as typeof TextDecoder.prototype.decode;
    try {
      installWorkerRealmCompat();
      const s = makeSweepSources();
      const opts = { stream: false };
      const streamOpts = { stream: true };
      const finalOpts = { stream: false };
      const returns = runSweep(new TextDecoder(), s, opts, streamOpts, finalOpts);
      assertOrderedLog(log, returns, s, opts, streamOpts, finalOpts);
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

describe('shared-input FIRST-error identity + throw count 1 — fresh TypeError per call, EVERY shared class (parity 9 sibling)', () => {
  // A native-first wrapper that retries only on TypeError passes a
  // generic-Error row; one that retries only for DataView/raw/streaming inputs
  // passes a Uint8Array-only row. Fresh TypeErrors across the whole shared
  // class set: any retry propagates the SECOND object with count 2.
  function makeFreshTypeErrorDecoder(): { Dec: typeof TextDecoder; thrown: TypeError[] } {
    const thrown: TypeError[] = [];
    class FreshTypeErrorDecoder {
      decode(): string {
        const err = new TypeError(`fresh-typeerror-${thrown.length}`);
        thrown.push(err);
        throw err;
      }
    }
    return { Dec: FreshTypeErrorDecoder as unknown as typeof TextDecoder, thrown };
  }

  function sharedClassInputs(): [string, unknown, object | undefined][] {
    const { sab, view, dataView } = makeSentinelSab();
    const streamSab = new SharedArrayBuffer(1);
    new Uint8Array(streamSab)[0] = 0xc3;
    return [
      ['shared Uint8Array', view, undefined],
      ['shared DataView', dataView, undefined],
      ['raw SharedArrayBuffer', sab, undefined],
      ['streaming shared view', new Uint8Array(streamSab, 0, 1), { stream: true }],
    ];
  }

  it('direct install: each shared class propagates the FIRST TypeError with throw count EXACTLY 1', () => {
    for (const [label, input, opts] of sharedClassInputs()) {
      const { Dec, thrown } = makeFreshTypeErrorDecoder();
      installSharedMemoryTolerantTextDecoder(Dec);
      let caught: unknown;
      try {
        new Dec().decode(input as Uint8Array, opts as TextDecodeOptions | undefined);
      } catch (err) {
        caught = err;
      }
      expect(thrown, label).toHaveLength(1);
      expect(caught, label).toBe(thrown[0]);
    }
  });

  it('aggregate install (installWorkerRealmCompat): same pins through the realm TextDecoder', () => {
    const realDecode = TextDecoder.prototype.decode;
    const hadSelf = 'self' in globalThis;
    const savedSelf = (globalThis as { self?: unknown }).self;
    try {
      for (const [label, input, opts] of sharedClassInputs()) {
        const thrown: TypeError[] = [];
        TextDecoder.prototype.decode = ((): string => {
          const err = new TypeError(`fresh-typeerror-${thrown.length}`);
          thrown.push(err);
          throw err;
        }) as typeof TextDecoder.prototype.decode;
        installWorkerRealmCompat();
        let caught: unknown;
        try {
          new TextDecoder().decode(input as Uint8Array, opts as TextDecodeOptions | undefined);
        } catch (err) {
          caught = err;
        }
        expect(thrown, label).toHaveLength(1);
        expect(caught, label).toBe(thrown[0]);
      }
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

  it('installs a writable self === globalThis (assignment is a harmless no-op)', () => {
    installWritableSelf();
    expect((globalThis as { self?: unknown }).self).toBe(globalThis);
    // emnapi's `globalThis.self = globalThis` must not throw after this.
    expect(() => {
      (globalThis as { self?: unknown }).self = globalThis;
    }).not.toThrow();
  });

  // ADDED strengthened pin (checkpoint-4 B4) — the pre-existing test above is
  // the unmodified baseline carrier and stays byte-identical to main.
  it('strengthened pin: self is an OWN writable DATA property, pre-write value globalThis', () => {
    installWritableSelf();
    // Pre-write value + ownership + descriptor BEFORE any assignment: a null
    // value or an inherited setter must fail here, not be masked by the write.
    expect((globalThis as { self?: unknown }).self).toBe(globalThis);
    expect(Object.hasOwn(globalThis, 'self')).toBe(true);
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'self');
    expect(desc !== undefined && 'value' in desc && desc.writable).toBe(true);
    (globalThis as { self?: unknown }).self = globalThis;
    expect((globalThis as { self?: unknown }).self).toBe(globalThis);
  });
});
