/**
 * T9 handle-lifetime + bidirectional-callable unit tests over a REAL QuickJS
 * context + Membrane (no mocks — the unit under test is the membrane/controller).
 *
 * GC timing is non-deterministic, so we DON'T rely on FinalizationRegistry firing.
 * The deterministic guarantee under test is the REFCOUNT decision logic via the
 * controller's explicit `releaseWrapper` (the exact code path the FR finalizer
 * runs): the QuickJSContext is disposed ONLY when pending AND no wrapper-backed
 * handle is live, so `ctx.dispose()` never trips the leaked-handle abort. The
 * GC-driven path is exercised under stress in T18.
 */

import type { QuickJSContext } from 'quickjs-emscripten-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { Membrane } from './membrane.ts';
import { ensureVmEngineReady, getQuickJsModuleSync } from './quickjs-loader.ts';

beforeAll(async () => {
  await ensureVmEngineReady();
});

function freshContext(): QuickJSContext {
  return getQuickJsModuleSync().newContext();
}

describe('ContextLifetime — no-abort disposal guarantee', () => {
  it('disposes safely when no wrapper-backed handle is live (only infra)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // A primitive completion creates NO host wrapper, but `wrapGuestToHost`
    // lazy-installs the idOf registry (infra) — so teardown exercises infra
    // disposal followed by `ctx.dispose()` with zero live wrappers.
    const h = ctx.unwrapResult(ctx.evalCode('1 + 1'));
    expect(membrane.wrapGuestToHost(h)).toBe(2);
    h.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });

  it('defers disposal while a wrapper-backed handle is live, then disposes on release', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const h = ctx.unwrapResult(ctx.evalCode('({a:1})'));
    const wrapper = membrane.wrapGuestToHost(h) as object;
    h.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(1);

    // Pending while a wrapper is live → MUST NOT dispose (would abort).
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(false);

    // Releasing the last live wrapper (what GC eventually does) → safe teardown.
    membrane.lifetime.releaseWrapper(wrapper);
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('one wrapper per guest id; releasing it evicts the identity-cache entry', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const h = ctx.unwrapResult(ctx.evalCode('({a:1})'));
    const w1 = membrane.wrapGuestToHost(h);
    const w2 = membrane.wrapGuestToHost(h); // same guest id → cache hit → same wrapper
    expect(w1 === w2).toBe(true);
    expect(membrane.lifetime.liveWrapperCount).toBe(1);

    membrane.lifetime.releaseWrapper(w1 as object);
    expect(membrane.lifetime.liveWrapperCount).toBe(0);

    // After eviction a fresh marshal builds a NEW wrapper (cache no longer hits).
    // Compare via `===` captured into a boolean — NEVER hand a wrapper backed by a
    // disposed handle to vitest's matcher (it may walk proxy traps → use-after-free).
    const w3 = membrane.wrapGuestToHost(h);
    expect(w3 === w1).toBe(false);
    expect(membrane.lifetime.liveWrapperCount).toBe(1);
    h.dispose();

    // Release before teardown so no live proxy survives the disposed context.
    membrane.lifetime.releaseWrapper(w3 as object);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });
});

// GC-driven reclaim is the PRODUCTION path but FinalizationRegistry gives no
// timing guarantee — only run when Node exposes `globalThis.gc` (`--expose-gc`);
// otherwise document reliance on the deterministic refcount tests above + T18.
const maybeGc = (globalThis as { gc?: () => void }).gc;
const gcIt = maybeGc ? it : it.skip;

describe('ContextLifetime — GC-driven reclaim (needs --expose-gc)', () => {
  gcIt('a GC-collected wrapper frees its guest handle (bounds growth)', async () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // Create many object wrappers, dropping every reference each iteration.
    for (let i = 0; i < 50; i++) {
      const h = ctx.unwrapResult(ctx.evalCode(`({i:${i}})`));
      void (membrane.wrapGuestToHost(h) as { i: number }).i;
      h.dispose();
    }
    const peak = membrane.lifetime.liveWrapperCount;
    expect(peak).toBeGreaterThan(0);
    for (let pass = 0; pass < 5 && membrane.lifetime.liveWrapperCount > 0; pass++) {
      (maybeGc as () => void)();
      await new Promise((r) => setTimeout(r, 0));
    }
    // GC + finalizers ran → live wrapper count dropped (growth is bounded).
    expect(membrane.lifetime.liveWrapperCount).toBeLessThan(peak);
    membrane.lifetime.markPending();
  });
});

describe('ContextLifetime — leak-safe wrapper construction (review regression)', () => {
  // The array wrapper DUPs the guest handle, then EAGERLY marshals every element
  // into the host target. If an element's OUT-marshal THROWS mid-construction
  // (here a guest element whose `Symbol.toStringTag` getter throws — surfaced when
  // the membrane probes its brand for exotic detection), the dup must already be
  // TRACKED. Before the leak-safe fix it was tracked only AFTER the element loop,
  // so a throw left an UNTRACKED live handle: `#live` stayed 0, and a later
  // `markPending` → `ctx.dispose()` aborted the WASM runtime (`Assertion failed:
  // list_empty(&rt->gc_obj_list)`). After the fix the throw must leave NO leaked
  // live handle, so disposal completes cleanly. (Originally triggered via the
  // since-implemented T10 symbol boundary; the throwing-getter trigger exercises
  // the SAME track-before-throwable-work path without an unimplemented boundary.)
  const THROWING_ELEMENT = '{ get [Symbol.toStringTag]() { throw new Error("boom") } }';

  it('a throwing OUT-marshal element leaks no live handle (no abort on dispose)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const h = ctx.unwrapResult(ctx.evalCode(`[ ${THROWING_ELEMENT} ]`));
    // Marshalling OUT must throw (the element's brand probe throws).
    expect(() => membrane.wrapGuestToHost(h)).toThrow(/boom/);
    h.dispose();
    // INVARIANT: the throw must not leave an untracked live guest handle. Either it
    // was tracked (refcount reflects it) or disposed on the throw path — but no
    // SILENTLY-LEAKED handle. With zero outstanding wrappers, teardown is clean.
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });

  it('a throwing OUT-marshal of a nested array element leaks no live handle (no abort)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const h = ctx.unwrapResult(ctx.evalCode(`[ [ ${THROWING_ELEMENT} ] ]`));
    // The OUTER array marshals its element (the inner array) → the inner array
    // marshals its throwing element → throws. Both wrapper constructions are in
    // flight; neither may leak an untracked handle.
    expect(() => membrane.wrapGuestToHost(h)).toThrow(/boom/);
    h.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });
});

describe('exotic mirroring + symbols — identity & disposal (T10)', () => {
  it('same guest Date returned twice → same host wrapper; release tears down clean', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    ctx.unwrapResult(ctx.evalCode('globalThis.D = new Date(5)')).dispose();
    const h1 = ctx.unwrapResult(ctx.evalCode('D'));
    const h2 = ctx.unwrapResult(ctx.evalCode('D'));
    const w1 = membrane.wrapGuestToHost(h1) as Date;
    const w2 = membrane.wrapGuestToHost(h2);
    expect(w1 === w2).toBe(true); // identity-cached by guest id
    expect(w1.getTime()).toBe(5);
    expect(w1 instanceof Date).toBe(false); // cross-realm
    expect(Object.prototype.toString.call(w1)).toBe('[object Date]');
    h1.dispose();
    h2.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(1); // one backing handle
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(false); // wrapper live → deferred
    membrane.lifetime.releaseWrapper(w1);
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });

  it('host Date round-trips IN then OUT to the SAME host object (#14)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const hostDate = new Date(1000);
    const seed = membrane.marshalHostToGuest(hostDate);
    ctx.setProp(ctx.global, 'hd', seed);
    seed.dispose();
    const back = ctx.unwrapResult(ctx.evalCode('hd'));
    expect(membrane.wrapGuestToHost(back)).toBe(hostDate); // original host ref
    back.dispose();
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('guest unique symbol OUT: same symbol → same host symbol, fresh (not ===), desc preserved', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    ctx.unwrapResult(ctx.evalCode('globalThis.S = Symbol("x")')).dispose();
    const h1 = ctx.unwrapResult(ctx.evalCode('S'));
    const h2 = ctx.unwrapResult(ctx.evalCode('S'));
    const s1 = membrane.wrapGuestToHost(h1) as symbol;
    const s2 = membrane.wrapGuestToHost(h2) as symbol;
    expect(typeof s1).toBe('symbol');
    expect(s1).toBe(s2); // identity-cached
    expect(s1.description).toBe('x');
    h1.dispose();
    h2.dispose();
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('well-known symbol OUT is the SHARED host symbol (=== Symbol.iterator)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const h = ctx.unwrapResult(ctx.evalCode('Symbol.iterator'));
    expect(membrane.wrapGuestToHost(h)).toBe(Symbol.iterator);
    h.dispose();
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('host symbol round-trips IN then OUT to the SAME host symbol', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const hostSym = Symbol('hs');
    const seed = membrane.marshalHostToGuest(hostSym);
    ctx.setProp(ctx.global, 's', seed);
    seed.dispose();
    const back = ctx.unwrapResult(ctx.evalCode('s'));
    expect(membrane.wrapGuestToHost(back)).toBe(hostSym);
    back.dispose();
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });
});

describe('error marshalling — identity & disposal (T11)', () => {
  it('OUT guest error: cross-realm shape (instanceof FALSE, ctor.name/name/message/stack faithful)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // The engine inspects the {error} handle (no unwrapResult) and marshals it.
    const res = ctx.evalCode('throw new TypeError("boom")');
    expect('error' in res && res.error !== undefined).toBe(true);
    const errH = (res as { error: import('quickjs-emscripten-core').QuickJSHandle }).error;
    const e = membrane.wrapGuestError(errH) as Error & { constructor: { name: string } };
    // Capture cross-realm probes into booleans BEFORE any teardown.
    const isErr = e instanceof Error;
    const ctorName = e.constructor.name;
    expect(isErr).toBe(false); // cross-realm: proto is NOT host Error.prototype
    expect(ctorName).toBe('TypeError');
    expect(e.name).toBe('TypeError');
    expect(e.message).toBe('boom');
    expect(typeof e.stack === 'string' && e.stack.length > 0).toBe(true);
    expect(e.toString()).toBe('TypeError: boom');
    // Genuinely catchable/rethrowable host value.
    expect(
      (() => {
        try {
          throw e;
        } catch (x) {
          return x === e;
        }
      })(),
    ).toBe(true);
    errH.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(1); // one error backing handle
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(false); // wrapper live → deferred
    membrane.lifetime.releaseWrapper(e);
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });

  it('non-Error throw marshals as the raw primitive (catch sees 42)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const res = ctx.evalCode('throw 42');
    const errH = (res as { error: import('quickjs-emscripten-core').QuickJSHandle }).error;
    expect(membrane.wrapGuestError(errH)).toBe(42); // primitive, not an Error wrapper
    errH.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(0); // no wrapper for a primitive
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('same guest error marshalled twice → same host wrapper (identity-cached)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    ctx.unwrapResult(ctx.evalCode('globalThis.E = new RangeError("r")')).dispose();
    const h1 = ctx.unwrapResult(ctx.evalCode('E'));
    const h2 = ctx.unwrapResult(ctx.evalCode('E'));
    const w1 = membrane.wrapGuestToHost(h1) as Error;
    const w2 = membrane.wrapGuestToHost(h2);
    expect(w1 === w2).toBe(true); // identity-cached by guest id
    h1.dispose();
    h2.dispose();
    expect(membrane.lifetime.liveWrapperCount).toBe(1);
    membrane.lifetime.releaseWrapper(w1);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('IN host error thrown from a seeded host fn → guest exception with faithful ctor.name/message', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const hostFn = (): never => {
      throw new RangeError('hostboom');
    };
    const guestFn = membrane.marshalHostToGuest(hostFn);
    ctx.setProp(ctx.global, 'boom', guestFn);
    guestFn.dispose();
    // Guest catches the host error: it is a REAL guest exception of the right ctor.
    const resH = ctx.unwrapResult(
      ctx.evalCode('try { boom() } catch (e) { e.constructor.name + ":" + e.message }'),
    );
    expect(membrane.wrapGuestToHost(resH)).toBe('RangeError:hostboom');
    resH.dispose();
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });
});

describe('bidirectional callables (T9)', () => {
  it('host fn seeded into the guest is callable; args marshal OUT, result marshals IN', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    let seenType = '';
    let seenIsArr = true;
    const hostFn = (x: unknown): unknown => {
      seenType = typeof x;
      // INTENTIONAL `instanceof Array` (not Array.isArray): the whole point of #16
      // is that a cross-realm guest array fails `instanceof hostArray` (FALSE) while
      // Array.isArray would be TRUE. Swapping it would invert the assertion.
      // biome-ignore lint/suspicious/useIsArray: cross-realm identity probe (#16) — see comment.
      seenIsArr = x instanceof Array;
      return { ok: true };
    };
    const guestFn = membrane.marshalHostToGuest(hostFn);
    ctx.setProp(ctx.global, 'host', guestFn);
    guestFn.dispose();

    const resH = ctx.unwrapResult(ctx.evalCode('host([9]).ok'));
    expect(membrane.wrapGuestToHost(resH)).toBe(true);
    resH.dispose();
    // #16: a guest array arg seen in the host keeps the guest prototype.
    expect(seenType).toBe('object');
    expect(seenIsArr).toBe(false);

    // The guest array arg became a live OUT wrapper during the call (bounded by GC
    // in production); it keeps the context pending-but-alive until released.
    expect(membrane.lifetime.liveWrapperCount).toBeGreaterThan(0);
  });

  it('same host fn → same guest fn handle (inbound identity) and round-trips back', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const hostFn = (): number => 1;
    const a = membrane.marshalHostToGuest(hostFn);
    const b = membrane.marshalHostToGuest(hostFn);
    expect(ctx.eq(a, b)).toBe(true); // same guest fn
    // Round-trip OUT recovers the ORIGINAL host fn (no new wrapper).
    expect(membrane.wrapGuestToHost(a)).toBe(hostFn);
    a.dispose();
    b.dispose();
    // Inbound host fns are infra (no live wrapper) → clean teardown.
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('guest callback passed to a host fn is held + callable AFTER the run', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    let stored: ((...a: unknown[]) => unknown) | undefined;
    const keep = (cb: unknown): void => {
      stored = cb as (...a: unknown[]) => unknown;
    };
    const guestKeep = membrane.marshalHostToGuest(keep);
    ctx.setProp(ctx.global, 'keep', guestKeep);
    guestKeep.dispose();

    // Run finishes; the guest callback must survive on the still-alive context.
    ctx.unwrapResult(ctx.evalCode('keep(() => 123)')).dispose();
    expect(stored).toBeTypeOf('function');
    expect((stored as () => unknown)()).toBe(123);

    // The held callback is a live OUT wrapper → markPending defers; releasing it
    // (what GC eventually does) tears the context down safely.
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(false);
    membrane.lifetime.releaseWrapper(stored as object);
    expect(membrane.lifetime.disposed).toBe(true);
  });
});
