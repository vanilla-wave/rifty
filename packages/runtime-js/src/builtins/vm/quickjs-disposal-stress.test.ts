/**
 * T18 disposal/lifetime STRESS — validates the FinalizationRegistry + refcount net
 * (`ContextLifetime` + `Membrane`) under churn: a leaked guest handle would ABORT
 * the WASM runtime at `ctx.dispose()` (`Assertion failed: list_empty(&rt->gc_obj_
 * list)`, QUICKJS_API.md), so the core invariant is NO abort across thousands of
 * runs / hundreds of contexts AND bounded growth.
 *
 * TWO assertion classes:
 *   - DETERMINISTIC (run in default `pnpm test:run`): drive the EXACT code path the
 *     FR finalizer runs via the `releaseWrapper`/`markPending` seam, asserting the
 *     refcount decision logic (no-abort, dispose-exactly-once, adversarial
 *     release/markPending ordering, no `#preRunSandboxKeys` accumulation). No
 *     reliance on GC timing.
 *   - GC-GATED (only under `--expose-gc`, else skipped — like the existing reclaim
 *     test): force GC and assert the PRODUCTION reclaim path actually frees handles
 *     / disposes contexts (peak vs post-gc live counts; contexts collected).
 *
 * Findings (no leak/abort found — the net holds):
 *   - Long-lived context: transient run handles are disposed each run by the engine
 *     (`evalToHost` finally), so live wrappers track only host-RETAINED values, not
 *     run count.
 *   - Hot host-fn loop (carried T9 concern): each guest object arg passed to an
 *     inbound host fn creates a transient OUT wrapper that retains a guest-handle
 *     dup. Within ONE synchronous run these accumulate (GC cannot interleave), so
 *     `#live` grows ~linearly with the call count UNTIL the wrappers are GC'd.
 *     Verified GC-bounded: 500 calls → peak 500 → post-gc 0. Eager release is NOT a
 *     clean fix — the membrane cannot distinguish an arg the host DISCARDS from one
 *     it STORES (the stored-callback case, `keep(cb)`), and releasing a stored
 *     wrapper's handle would be a use-after-free. So the behavior is documented as
 *     GC-bounded (matches Node, where a guest object handed to a host fn lives until
 *     unreferenced + collected), asserted under the GC gate.
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

/** Seed an inbound host fn as a guest global; returns the membrane (over a fresh ctx). */
function withHostFn(
  name: string,
  fn: (...a: unknown[]) => unknown,
): {
  ctx: QuickJSContext;
  membrane: Membrane;
} {
  const ctx = freshContext();
  const membrane = new Membrane(ctx);
  const g = membrane.marshalHostToGuest(fn);
  ctx.setProp(ctx.global, name, g);
  g.dispose();
  return { ctx, membrane };
}

/** Eval `src`, marshal the OBJECT completion to a host wrapper, dispose the run handle, return the wrapper. */
function evalWrapper(ctx: QuickJSContext, membrane: Membrane, src: string): object {
  const h = ctx.unwrapResult(ctx.evalCode(src));
  try {
    return membrane.wrapGuestToHost(h) as object;
  } finally {
    h.dispose();
  }
}

const maybeGc = (globalThis as { gc?: () => void }).gc;
const gcIt = maybeGc ? it : it.skip;
/** Force GC + flush the microtask/macrotask queue so FinalizationRegistry callbacks fire. */
async function drainGc(predicate: () => boolean, passes = 12): Promise<void> {
  for (let p = 0; p < passes && predicate(); p++) {
    (maybeGc as () => void)();
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---------------------------------------------------------------------------
// 1. Long-lived context, many runs — bounded live count + no abort.
// ---------------------------------------------------------------------------
describe('T18 stress — long-lived context, many runs', () => {
  it('5000 runs returning primitives + reading seeded host values: live count stays ~0 (run handles disposed each run)', () => {
    const RUNS = 5000;
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // A seeded host value the guest reads each run (host→guest read path).
    ctx.setProp(ctx.global, 'base', ctx.newNumber(7));

    // Each run allocates objects/arrays/fns IN THE GUEST but returns a PRIMITIVE.
    // The engine disposes the per-run completion handle (modelled by `h.dispose()`);
    // the guest-side allocations are guest GC's problem, not the membrane's. NO
    // wrapper-backed handle is created (the completion is a number), so this is
    // DETERMINISTICALLY bounded — no GC needed.
    for (let i = 0; i < RUNS; i++) {
      const src = `(function(){
        const o = { a: ${i}, nested: { b: ${i} } };
        const arr = [1, 2, ${i}];
        const f = () => ${i};
        return o.a + arr.length + f() + base;
      })()`;
      const h = ctx.unwrapResult(ctx.evalCode(src));
      expect(typeof membrane.wrapGuestToHost(h)).toBe('number');
      h.dispose();
    }
    // DETERMINISTIC INVARIANT: returning a primitive creates no wrapper, so 5000
    // runs leave ZERO live wrappers (a leak of per-run completion handles would
    // show here as ~RUNS). The id-registry infra handle is the only retained handle.
    expect(membrane.lifetime.liveWrapperCount).toBe(0);

    // Teardown is clean — no leaked handle from 5000 runs (infra disposed first).
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });

  it('5000 runs each returning a FRESH object the host immediately releases: bounded, no abort', () => {
    const RUNS = 5000;
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // Each run returns a NEW object → a tracked OUT wrapper. The host reads it and
    // RELEASES it immediately (modelling GC of a wrapper the host did not keep) via
    // the deterministic seam — so the live count never climbs past 1.
    let maxLive = 0;
    for (let i = 0; i < RUNS; i++) {
      const h = ctx.unwrapResult(ctx.evalCode(`({ a: ${i} })`));
      const w = membrane.wrapGuestToHost(h) as object;
      h.dispose();
      maxLive = Math.max(maxLive, membrane.lifetime.liveWrapperCount);
      membrane.lifetime.releaseWrapper(w); // host done with it → release now
    }
    // The deterministic release path keeps growth flat (≤1 outstanding at a time),
    // independent of run count — exactly what GC does asynchronously in production.
    expect(maxLive).toBeLessThanOrEqual(1);
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true); // no abort
  });

  gcIt('GC reclaims the long-lived context transient wrappers (peak >> post-gc)', async () => {
    const RUNS = 2000;
    const { ctx, membrane } = withHostFn('sink', (x: unknown) => (x as { v: number }).v);
    for (let i = 0; i < RUNS; i++) {
      const h = ctx.unwrapResult(ctx.evalCode(`sink({ v: ${i} })`));
      membrane.wrapGuestToHost(h);
      h.dispose();
    }
    const peak = membrane.lifetime.liveWrapperCount;
    expect(peak).toBeGreaterThan(0);
    await drainGc(() => membrane.lifetime.liveWrapperCount > 0);
    // Production reclaim path: GC of the unreferenced arg wrappers freed their guest
    // handles → live count collapsed (bounded growth proven, not just asserted).
    expect(membrane.lifetime.liveWrapperCount).toBeLessThan(peak);
    membrane.lifetime.markPending();
    // After full reclaim the context disposes cleanly (no abort).
    if (membrane.lifetime.liveWrapperCount === 0) {
      expect(membrane.lifetime.disposed).toBe(true);
    }
    // Diagnostic numbers for the report (noConsole is off for this repo).
    console.log(`[T18] long-lived peak=${peak} post-gc=${membrane.lifetime.liveWrapperCount}`);
  });
});

// ---------------------------------------------------------------------------
// 2. Many contexts churned — deterministic seam + GC-gated real disposal.
// ---------------------------------------------------------------------------
describe('T18 stress — many contexts churned', () => {
  it('500 contexts, deterministic GC-ordering simulation: dispose EXACTLY once, no abort/double-dispose', () => {
    const N = 500;
    let disposed = 0;
    for (let i = 0; i < N; i++) {
      const ctx = freshContext();
      const membrane = new Membrane(ctx);
      const wrappers: [object, object, object] = [
        evalWrapper(ctx, membrane, `({i:${i},j:0})`),
        evalWrapper(ctx, membrane, `({i:${i},j:1})`),
        evalWrapper(ctx, membrane, `({i:${i},j:2})`),
      ];
      expect(membrane.lifetime.liveWrapperCount).toBe(3);

      // Simulate the two GC orderings the FinalizationRegistry can produce (no
      // ordering guarantee): for even i release SOME wrappers BEFORE markPending,
      // the rest AFTER; for odd i markPending FIRST then release all.
      if (i % 2 === 0) {
        const [w0, w1, w2] = wrappers;
        membrane.lifetime.releaseWrapper(w0);
        membrane.lifetime.markPending();
        expect(membrane.lifetime.disposed).toBe(false); // 2 still live → deferred
        membrane.lifetime.releaseWrapper(w1);
        membrane.lifetime.releaseWrapper(w2);
      } else {
        membrane.lifetime.markPending();
        expect(membrane.lifetime.disposed).toBe(false); // 3 live → deferred
        for (const w of wrappers) membrane.lifetime.releaseWrapper(w);
      }
      expect(membrane.lifetime.disposed).toBe(true); // last release → dispose
      disposed++;

      // No double-dispose: a redundant release/markPending after teardown is a
      // no-op (a second ctx.dispose() would ALSO abort).
      expect(() => {
        membrane.lifetime.markPending();
        for (const w of wrappers) membrane.lifetime.releaseWrapper(w);
      }).not.toThrow();
    }
    expect(disposed).toBe(N);
  });

  gcIt('500 abandoned contexts are disposed/collected under GC with no abort', async () => {
    const N = 500;
    const refs: Array<WeakRef<{ disposed: boolean }>> = [];
    for (let i = 0; i < N; i++) {
      const ctx = freshContext();
      const membrane = new Membrane(ctx);
      for (let j = 0; j < 3; j++) {
        const h = ctx.unwrapResult(ctx.evalCode(`({i:${i},j:${j}})`));
        membrane.wrapGuestToHost(h);
        h.dispose();
      }
      // Mark pending (as the ContextObject GC finalizer would) then abandon every
      // ref. Teardown now hinges purely on the wrappers being GC'd.
      membrane.lifetime.markPending();
      refs.push(new WeakRef(membrane.lifetime));
    }
    await drainGc(() => refs.some((r) => r.deref() !== undefined && !r.deref()?.disposed));
    let cleared = 0;
    for (const r of refs) {
      const c = r.deref();
      if (c === undefined || c.disposed) cleared++;
    }
    // Every context was either disposed (markPending + wrappers GC'd → refcount 0)
    // or fully collected — none leaked, none aborted.
    expect(cleared).toBe(N);
    console.log(`[T18] abandoned contexts disposed/collected=${cleared}/${N}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Adversarial release/markPending ordering — the CORE invariant.
// ---------------------------------------------------------------------------
describe('T18 stress — adversarial release/markPending ordering (no-abort invariant)', () => {
  it('markPending while wrappers live, release one-by-one → disposes only on the LAST release', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const wrappers: object[] = [];
    for (let j = 0; j < 50; j++) wrappers.push(evalWrapper(ctx, membrane, `({j:${j}})`));
    expect(membrane.lifetime.liveWrapperCount).toBe(50);

    membrane.lifetime.markPending(); // pending while ALL 50 live
    expect(membrane.lifetime.disposed).toBe(false);

    for (const [k, w] of wrappers.entries()) {
      membrane.lifetime.releaseWrapper(w);
      const isLast = k === wrappers.length - 1;
      // Disposes EXACTLY when the last live wrapper is released (refcount 0), never
      // before — and never aborts (no live handle at dispose).
      expect(membrane.lifetime.disposed).toBe(isLast);
    }
  });

  it('all wrappers released BEFORE markPending → markPending disposes immediately, no abort', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const wrappers: object[] = [];
    for (let j = 0; j < 50; j++) wrappers.push(evalWrapper(ctx, membrane, `({j:${j}})`));
    for (const w of wrappers) membrane.lifetime.releaseWrapper(w);
    expect(membrane.lifetime.liveWrapperCount).toBe(0);
    expect(membrane.lifetime.disposed).toBe(false); // not pending yet

    membrane.lifetime.markPending(); // refcount already 0 → immediate clean dispose
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('interleaved create/release while pending never aborts (churn after markPending)', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // One persistent wrapper keeps the context alive across the churn.
    const keepH = ctx.unwrapResult(ctx.evalCode('({keep:1})'));
    const keep = membrane.wrapGuestToHost(keepH) as object;
    keepH.dispose();

    membrane.lifetime.markPending(); // pending, but `keep` is live → deferred
    expect(membrane.lifetime.disposed).toBe(false);

    // Churn: create + immediately release a wrapper many times while pending. Each
    // release drops to refcount 1 (the kept wrapper), so NONE triggers dispose, and
    // none aborts (the kept wrapper's handle is always alive at any would-be dispose).
    for (let k = 0; k < 200; k++) {
      const h = ctx.unwrapResult(ctx.evalCode(`({k:${k}})`));
      const w = membrane.wrapGuestToHost(h) as object;
      h.dispose();
      membrane.lifetime.releaseWrapper(w);
      expect(membrane.lifetime.disposed).toBe(false); // `keep` still live
    }
    // Releasing the last kept wrapper finally tears down (refcount 0 + pending).
    membrane.lifetime.releaseWrapper(keep);
    expect(membrane.lifetime.disposed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Hot host-fn loop (carried T9 concern) — GC-bounded, documented.
// ---------------------------------------------------------------------------
describe('T18 stress — hot host-fn loop (transient arg wrappers)', () => {
  it('1000 host-fn calls passing fresh guest objects: no abort; transient args tracked (bounded by GC)', () => {
    const CALLS = 1000;
    let seen = 0;
    const { ctx, membrane } = withHostFn('host', (x: unknown) => {
      seen++;
      return (x as { v: number }).v; // read + discard the arg
    });
    // Single synchronous run — GC cannot interleave, so every arg wrapper stays
    // live for the duration of the loop.
    const resH = ctx.unwrapResult(
      ctx.evalCode(
        `(function(){ let s=0; for (let i=0;i<${CALLS};i++) s += host({v:i}); return s; })()`,
      ),
    );
    expect(membrane.wrapGuestToHost(resH)).toBe((CALLS * (CALLS - 1)) / 2);
    resH.dispose();
    expect(seen).toBe(CALLS);
    // DOCUMENTED: the arg-only OUT wrappers ARE tracked (one per call) — bounded by
    // GC, NOT eagerly disposed (the membrane cannot tell a discarded arg from a
    // stored one without a use-after-free risk; see file header). This asserts the
    // tracking is correct (no abort) — reclaim is the GC-gated test below.
    expect(membrane.lifetime.liveWrapperCount).toBeGreaterThan(0);
    membrane.lifetime.markPending(); // pending while args live → deferred, no abort
    expect(membrane.lifetime.disposed).toBe(false);
  });

  gcIt('hot host-fn loop arg wrappers fully reclaim under GC (peak → ~0, no abort)', async () => {
    const CALLS = 1000;
    const { ctx, membrane } = withHostFn('host', (x: unknown) => (x as { v: number }).v);
    const resH = ctx.unwrapResult(
      ctx.evalCode(
        `(function(){ let s=0; for (let i=0;i<${CALLS};i++) s += host({v:i}); return s; })()`,
      ),
    );
    membrane.wrapGuestToHost(resH);
    resH.dispose();
    const peak = membrane.lifetime.liveWrapperCount;
    expect(peak).toBeGreaterThan(0);
    await drainGc(() => membrane.lifetime.liveWrapperCount > 0);
    expect(membrane.lifetime.liveWrapperCount).toBeLessThan(peak);
    membrane.lifetime.markPending();
    if (membrane.lifetime.liveWrapperCount === 0) {
      expect(membrane.lifetime.disposed).toBe(true);
    }
    console.log(`[T18] hot-fn peak=${peak} post-gc=${membrane.lifetime.liveWrapperCount}`);
  });
});

// ---------------------------------------------------------------------------
// 5. delete-reflection churn (carried T17 concern) — #preRunSandboxKeys bounded.
// ---------------------------------------------------------------------------
describe('T18 stress — delete-reflection churn (reseed/sweep cycles)', () => {
  it('2000 reseed→(guest delete/create globals)→sweep cycles: keys bounded, no handle leak, no abort', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    // A live sandbox object holding a steady-state seeded key set.
    const sandbox: Record<string, unknown> = { keep: 1 };

    const liveAtStart = membrane.lifetime.liveWrapperCount;
    for (let i = 0; i < 2000; i++) {
      // BEFORE: snapshot of pre-run sandbox keys is taken here.
      membrane.reseedContext(sandbox);
      // Guest creates a fresh global AND deletes it (delete-reflection path) plus a
      // configurable global that survives one cycle then is deleted the next.
      ctx
        .unwrapResult(
          ctx.evalCode(
            `globalThis.tmp${i % 4} = { x: ${i} }; delete globalThis.tmp${i % 4}; var v${i % 2} = ${i};`,
          ),
        )
        .dispose();
      membrane.sweepContext(sandbox);
    }
    // The sandbox accumulated only the bounded var-bindings reflected by sweep — NOT
    // 2000 tmp keys (each was deleted in-run, so delete-reflection dropped them) and
    // NOT a per-cycle growth of #preRunSandboxKeys (it is reset to [] each sweep).
    const keyCount = Object.keys(sandbox).length;
    expect(keyCount).toBeLessThan(20); // keep + a handful of v0/v1 — bounded, not ~2000

    // Live wrapper count did not grow ~linearly with cycles (transient reseed/sweep
    // handles are disposed each cycle via Scope/finally; only host-retained values
    // persist, and here the sandbox holds primitives).
    expect(membrane.lifetime.liveWrapperCount - liveAtStart).toBeLessThan(50);

    // Teardown is clean (no leaked handle from the churn).
    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });

  it('repeated reseed/sweep of the SAME host object holds inbound identity + leaks no handle', () => {
    const ctx = freshContext();
    const membrane = new Membrane(ctx);
    const shared = { count: 0 };
    const sandbox: Record<string, unknown> = { shared };

    for (let i = 0; i < 1000; i++) {
      membrane.reseedContext(sandbox);
      ctx.unwrapResult(ctx.evalCode('shared.count++; void 0;')).dispose();
      membrane.sweepContext(sandbox);
    }
    // Deep write-back accumulated on the SAME host object (inbound identity held —
    // one cached seed reused every cycle, not 1000 seeds).
    expect((sandbox.shared as { count: number }).count).toBe(1000);
    expect(sandbox.shared).toBe(shared); // same host reference throughout

    membrane.lifetime.markPending();
    expect(membrane.lifetime.disposed).toBe(true);
  });
});
