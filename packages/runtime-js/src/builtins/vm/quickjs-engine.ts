/**
 * QuickJS-WASM `node:vm` engine — primitives (T5) + the guest→host membrane (T6).
 *
 * Each {@link ContextObject} gets its own persistent `QuickJSContext` (one
 * runtime+context pair), created lazily and REUSED across every run so guest
 * state (top-level `var`/`function` declarations, mutations) survives between
 * runs — the cross-run persistence later tasks rely on. The context is disposed
 * only in {@link disposeContext}. Each context also gets one {@link Membrane}
 * (identity cache + wrappers) bound to it.
 *
 * Scope through T8: marshal guest completion values back to the host — primitives
 * directly, OBJECT/ARRAY/FUNCTION through the {@link Membrane} (cross-realm
 * wrappers, identity-cached) — AND reconcile the contextObject around every run.
 * Each run is bracketed by `membrane.reseedContext` (host→guest, BEFORE — picks up
 * between-run host mutations) and `membrane.sweepContext` (guest→host, AFTER —
 * deep write-back + new globals). Sync run semantics make this observationally
 * equivalent to a live contextObject (ADR-0138, T8). Errors still throw raw
 * (faithful error marshalling is T11).
 *
 * Disposal discipline (QUICKJS_API.md): a single leaked handle ABORTS the whole
 * WASM runtime at context teardown. Every PER-RUN handle (evalCode/unwrapResult)
 * is disposed before returning; context constants (undefined/null/true/false/
 * global) are NEVER disposed. The membrane RETAINS the handles backing live
 * wrappers — those persist until T9 wires wrapper lifetime, and `disposeContext`
 * may abort if called while wrappers are alive (the disposal-stress guard is T18).
 */

import type { QuickJSContext } from 'quickjs-emscripten-core';
import { Membrane } from './membrane.ts';
import { getQuickJsModuleSync } from './quickjs-loader.ts';
import type { CompiledScript, ContextObject, VmEngine } from './types.ts';

/** Per-context QuickJS runtime+membrane pair, created lazily and reused across runs. */
interface GuestRuntime {
  readonly qctx: QuickJSContext;
  readonly membrane: Membrane;
}

// One persistent QuickJSContext + Membrane per vm.Context, reused across runs.
// Reclaimed by disposeContext (and otherwise lives as long as the ContextObject —
// the WeakMap drops its entry when the key is GC'd, though the underlying WASM
// context must be explicitly disposed; full lifetime/GC handling is a later task).
const guestRuntimes = new WeakMap<ContextObject, GuestRuntime>();

function withSourceURL(code: string, filename?: string): string {
  if (!filename) return code;
  return `${code}\n//# sourceURL=${filename}`;
}

function getOrCreateGuestRuntime(context: ContextObject): GuestRuntime {
  let rt = guestRuntimes.get(context);
  if (!rt) {
    const qctx = getQuickJsModuleSync().newContext();
    const membrane = new Membrane(qctx);
    rt = { qctx, membrane };
    guestRuntimes.set(context, rt);
  }
  return rt;
}

function evalToHost(rt: GuestRuntime, context: ContextObject, source: string): unknown {
  const { qctx, membrane } = rt;
  // T7/T8 reconciliation around the SYNC run: reseed the LIVE contextObject INTO
  // the guest from CURRENT host state (so between-run host mutations are visible),
  // run, then sweep guest writes BACK to the host (deep mutations + new globals).
  // Sync semantics make this observationally equivalent to a live contextObject.
  membrane.reseedContext(context);
  const result = qctx.evalCode(source);
  // Node's contextObject is LIVE: writes made BEFORE a throw ARE observable to the
  // host (verified probe — `this.a=1; throw` → `sb.a===1`; deep `o.n=99; throw` →
  // `sb.o.n===99`). The sweep therefore runs in `finally` so it executes on BOTH
  // the success and throw paths. `unwrapResult` returns the success handle (caller
  // owns it) or throws the guest error as a native Error (disposing the error
  // handle itself — no double-dispose). The QuickJSContext stays alive after that
  // throw; `sweepContext` walks `ctx.global` and needs no completion handle, so it
  // is safe in finally. The raw throw then still propagates (faithful error
  // marshalling is T11).
  try {
    const handle = qctx.unwrapResult(result);
    try {
      // Primitives are marshalled by value; OBJECT/ARRAY/FUNCTION become membrane
      // wrappers that RETAIN an internal dup of the guest handle. Disposing this
      // per-run completion handle afterwards is therefore safe — the wrapper holds
      // its own retained dup, not this handle.
      return membrane.wrapGuestToHost(handle);
    } finally {
      handle.dispose();
    }
  } finally {
    // Reconcile guest writes back to the host on EVERY exit path. On throw this is
    // what makes pre-throw mutations visible (and prevents the next run's reseed
    // from clobbering them). Transient handles inside use Scope/finally; the
    // context is NOT disposed here.
    membrane.sweepContext(context);
  }
}

export const quickjsEngine: VmEngine = {
  name: 'quickjs',
  initContext(context) {
    // Create the persistent guest context+membrane eagerly so contextify cost is
    // paid at createContext time, not on first run. Idempotent via the WeakMap.
    // Seeding is deferred to the per-run `reseedContext` (T8) so reads always
    // reflect the CURRENT host state, not a stale create-time snapshot.
    getOrCreateGuestRuntime(context);
  },
  runInContext(code, context, filename) {
    return evalToHost(getOrCreateGuestRuntime(context), context, withSourceURL(code, filename));
  },
  compile(code, filename) {
    return { code, filename };
  },
  runCompiled(script: CompiledScript, context) {
    return evalToHost(
      getOrCreateGuestRuntime(context),
      context,
      withSourceURL(script.code, script.filename),
    );
  },
  disposeContext(context) {
    const rt = guestRuntimes.get(context);
    if (rt) {
      guestRuntimes.delete(context);
      // Disposes the context AND its runtime. Per-run completion handles are
      // disposed in evalToHost's finally, BUT membrane wrappers retain guest
      // handles (T6 bounds disposal — wrapper lifetime is T9). If any wrapper is
      // still alive this aborts the WASM runtime; the disposal-stress guard is T18.
      rt.qctx.dispose();
    }
  },
};
