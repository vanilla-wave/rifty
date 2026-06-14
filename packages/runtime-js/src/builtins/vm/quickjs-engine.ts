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
 * Scope through T7: marshal guest completion values back to the host — primitives
 * directly, OBJECT/ARRAY/FUNCTION through the {@link Membrane} (cross-realm
 * wrappers, identity-cached) — AND seed the live contextObject INTO the guest at
 * context creation (T7 read path, `membrane.seedContext`). Host-side mutation
 * re-sync between runs + guest→host write-back are T8; errors still throw raw
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
    // Seed the LIVE contextObject INTO the guest realm (T7 read path) BEFORE any
    // run, so seeded names are readable on first eval. Host-side mutation re-sync
    // between runs + guest→host write-back is T8.
    membrane.seedContext(context);
  }
  return rt;
}

function evalToHost(rt: GuestRuntime, source: string): unknown {
  const { qctx, membrane } = rt;
  const result = qctx.evalCode(source);
  // unwrapResult returns the success handle (caller owns it) or throws the guest
  // error as a native Error (disposing the error handle itself). A raw throw is
  // acceptable through T6 — faithful error marshalling is T11.
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
}

export const quickjsEngine: VmEngine = {
  name: 'quickjs',
  initContext(context) {
    // Create the persistent guest context+membrane eagerly so contextify cost is
    // paid at createContext time, not on first run. Idempotent via the WeakMap.
    getOrCreateGuestRuntime(context);
  },
  runInContext(code, context, filename) {
    return evalToHost(getOrCreateGuestRuntime(context), withSourceURL(code, filename));
  },
  compile(code, filename) {
    return { code, filename };
  },
  runCompiled(script: CompiledScript, context) {
    return evalToHost(
      getOrCreateGuestRuntime(context),
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
