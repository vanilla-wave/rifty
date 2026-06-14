/**
 * QuickJS-WASM `node:vm` engine — PRIMITIVE completion values only (T5).
 *
 * Each {@link ContextObject} gets its own persistent `QuickJSContext` (one
 * runtime+context pair), created lazily and REUSED across every run so guest
 * state (top-level `var`/`function` declarations, mutations) survives between
 * runs — the cross-run persistence later tasks rely on. The context is disposed
 * only in {@link disposeContext}.
 *
 * Scope of T5: marshal guest completion values that are PRIMITIVES back to the
 * host. Objects / functions throw a loud NotImplemented-style boundary (T6
 * wires the membrane). No sandbox sharing, no host→guest writes yet.
 *
 * Disposal discipline (QUICKJS_API.md): a single leaked handle ABORTS the whole
 * WASM runtime at context teardown. Every handle obtained from
 * evalCode/unwrapResult is disposed before returning; context constants
 * (undefined/null/true/false/global) are NEVER disposed.
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import { getQuickJsModuleSync } from './quickjs-loader.ts';
import type { CompiledScript, ContextObject, VmEngine } from './types.ts';

// One persistent QuickJSContext per vm.Context, reused across runs. Reclaimed by
// disposeContext (and otherwise lives as long as the ContextObject — the WeakMap
// drops its entry when the key is GC'd, though the underlying WASM context must
// be explicitly disposed; full lifetime/GC handling is a later task).
const guestContexts = new WeakMap<ContextObject, QuickJSContext>();

function withSourceURL(code: string, filename?: string): string {
  if (!filename) return code;
  return `${code}\n//# sourceURL=${filename}`;
}

function getOrCreateGuestContext(context: ContextObject): QuickJSContext {
  let qctx = guestContexts.get(context);
  if (!qctx) {
    qctx = getQuickJsModuleSync().newContext();
    guestContexts.set(context, qctx);
  }
  return qctx;
}

/**
 * Marshal a guest handle to a host PRIMITIVE. T5 supports number / string /
 * boolean / bigint / null / undefined only; objects and functions throw the T6
 * boundary. The caller still owns `handle` and must dispose it.
 *
 * Detection order matters: `null` is `typeof 'object'` so it is handled first
 * via `ctx.dump` (which reliably returns native `null`). For the value types we
 * use the verified-reliable extractors (`getNumber`/`getString`) and, for the
 * boolean/bigint pair that `ctx.typeof` reports correctly but the API doc flags
 * as historically unreliable for bigint, `ctx.dump` — empirically verified to
 * return a native boolean / native BigInt respectively (spike: `1n+2n` → 3n,
 * `typeof` 'bigint', dump typeof 'bigint').
 */
function marshalToHost(qctx: QuickJSContext, handle: QuickJSHandle): unknown {
  const kind = qctx.typeof(handle);
  switch (kind) {
    case 'undefined':
      return undefined;
    case 'number':
      return qctx.getNumber(handle);
    case 'string':
      return qctx.getString(handle);
    case 'boolean':
      // dump returns a native boolean; reliable and avoids a guest round-trip.
      return qctx.dump(handle) as boolean;
    case 'bigint':
      // `ctx.typeof` is historically unreliable for bigint, but `ctx.dump`
      // reliably returns a native BigInt (verified). Use dump as the source of
      // truth so this path is correct regardless of the typeof quirk.
      return qctx.dump(handle) as bigint;
    case 'object': {
      // null is typeof 'object' in QuickJS too — distinguish via dump.
      const dumped = qctx.dump(handle);
      if (dumped === null) return null;
      throw new Error('vm: object/function marshalling not implemented (Task 6)');
    }
    case 'function':
    case 'symbol':
      throw new Error('vm: object/function marshalling not implemented (Task 6)');
    default:
      // Any non-primitive `ctx.typeof` reports (or an unexpected kind) is the T6
      // boundary, not a silent placeholder.
      throw new Error(`vm: ${kind} marshalling not implemented (Task 6)`);
  }
}

function evalToHost(qctx: QuickJSContext, source: string): unknown {
  const result = qctx.evalCode(source);
  // unwrapResult returns the success handle (caller owns it) or throws the guest
  // error as a native Error (disposing the error handle itself). A raw throw is
  // acceptable for T5 — faithful error marshalling is T11.
  const handle = qctx.unwrapResult(result);
  try {
    return marshalToHost(qctx, handle);
  } finally {
    handle.dispose();
  }
}

export const quickjsEngine: VmEngine = {
  name: 'quickjs',
  initContext(context) {
    // Create the persistent guest context eagerly so contextify cost is paid at
    // createContext time, not on first run. Idempotent via the WeakMap guard.
    getOrCreateGuestContext(context);
  },
  runInContext(code, context, filename) {
    const qctx = getOrCreateGuestContext(context);
    return evalToHost(qctx, withSourceURL(code, filename));
  },
  compile(code, filename) {
    return { code, filename };
  },
  runCompiled(script: CompiledScript, context) {
    const qctx = getOrCreateGuestContext(context);
    return evalToHost(qctx, withSourceURL(script.code, script.filename));
  },
  disposeContext(context) {
    const qctx = guestContexts.get(context);
    if (qctx) {
      guestContexts.delete(context);
      // Disposes the context AND its runtime. Every per-run handle is already
      // disposed (evalToHost's finally), so the gc_obj_list is empty and this
      // does not abort the WASM runtime.
      qctx.dispose();
    }
  },
};
