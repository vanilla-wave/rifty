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
