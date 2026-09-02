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
 * equivalent to a live contextObject (ADR-0142, T8). A guest throw is marshalled
 * to a host THROWABLE — a cross-realm error mirror (`instanceof` FALSE,
 * `.constructor.name`/`.name`/`.message`/`.stack` faithful) or the raw primitive
 * for a non-Error throw (T11, via {@link Membrane#wrapGuestError}).
 *
 * Disposal discipline (QUICKJS_API.md): a single leaked handle ABORTS the whole
 * WASM runtime at context teardown. Every PER-RUN handle (evalCode/unwrapResult)
 * is disposed before returning; context constants (undefined/null/true/false/
 * global) are NEVER disposed. The membrane RETAINS the handles backing live
 * wrappers; their lifetime is managed by the membrane's {@link ContextLifetime}
 * controller (T9) — a FinalizationRegistry disposes a wrapper-backed handle when
 * the host GC's the wrapper, and the QuickJSContext is torn down ONLY when it is
 * pending-dispose AND no wrapper-backed handle is live, so `ctx.dispose()` never
 * trips the leaked-handle abort.
 *
 * Context lifetime: Node has NO vm-context teardown — the realm lives until GC. We
 * mirror that: normal runs NEVER dispose the context. The {@link ContextObject}
 * is registered in {@link contextRegistry}; when it is GC'd the finalizer marks
 * the controller pending (which tears the context down once handles are clear).
 * Explicit {@link disposeContext} also marks pending (deferring the actual
 * `ctx.dispose()` until wrappers are GC'd) — never an eager dispose-while-alive
 * abort (the disposal-stress guard is T18).
 */

import type { QuickJSContext } from 'quickjs-emscripten-core';
import type { ContextLifetime } from './context-lifetime.ts';
import { Membrane } from './membrane.ts';
import { getQuickJsModuleSync } from './quickjs-loader.ts';
import {
  type CompiledScript,
  type ContextObject,
  type VmEngine,
  getContextCodeGeneration,
} from './types.ts';

/** Per-context QuickJS runtime+membrane pair, created lazily and reused across runs. */
interface GuestRuntime {
  readonly qctx: QuickJSContext;
  readonly membrane: Membrane;
}

// One persistent QuickJSContext + Membrane per vm.Context, reused across runs.
// The WeakMap drops its entry when the ContextObject is GC'd; the underlying WASM
// context is torn down via the membrane's ContextLifetime controller (T9) once it
// is pending AND no wrapper-backed handle is live (never an eager abort).
const guestRuntimes = new WeakMap<ContextObject, GuestRuntime>();

// Marks the membrane's lifetime controller pending-dispose when the host GC's the
// ContextObject (Node has no vm-context teardown — the realm lives until GC). The
// held value is the controller, NOT the ContextObject (which would keep it alive);
// the controller outlives the membrane so it can finish teardown after GC.
const contextRegistry = new FinalizationRegistry<ContextLifetime>((lifetime) => {
  lifetime.markPending();
});

function withSourceURL(code: string, filename?: string): string {
  if (!filename) return code;
  return `${code}\n//# sourceURL=${filename}`;
}

function evalInfrastructure(qctx: QuickJSContext, source: string, feature: string): void {
  const result = qctx.evalCode(source);
  if (result.error !== undefined) {
    const dumped = qctx.dump(result.error);
    result.error.dispose();
    throw new Error(`${feature} bootstrap failed: ${String(dumped)}`);
  }
  result.value.dispose();
}

function applyCodeGenerationPolicy(qctx: QuickJSContext, context: ContextObject): void {
  const policy = getContextCodeGeneration(context);
  if (!policy || (policy.strings && policy.wasm)) return;
  evalInfrastructure(
    qctx,
    `
      (() => {
        const allowStrings = ${String(policy.strings)};
        const allowWasm = ${String(policy.wasm)};
        const facades = new WeakMap();
        let hasFacade = false;

        function replaceValue(owner, key, value) {
          const descriptor = Object.getOwnPropertyDescriptor(owner, key);
          if (!descriptor || !('value' in descriptor)) {
            throw new TypeError('Cannot guard intrinsic ' + String(key));
          }
          Object.defineProperty(owner, key, Object.assign({}, descriptor, { value }));
        }

        function facade(original, traps) {
          const guarded = new Proxy(original, traps);
          facades.set(guarded, original);
          hasFacade = true;
          return guarded;
        }

        if (!allowStrings) {
          const OriginalEval = eval;
          const OriginalFunction = Function;
          const constructors = [
            OriginalFunction,
            (async function () {}).constructor,
            (function* () {}).constructor,
            (async function* () {}).constructor
          ];
          function raiseDisabledCodeGeneration() {
            throw new EvalError('Code generation from strings disallowed for this context');
          }
          const guardedEval = facade(OriginalEval, {
            apply() {
              return raiseDisabledCodeGeneration();
            }
          });
          const guardedConstructors = constructors.map((original) => facade(original, {
            apply() {
              return raiseDisabledCodeGeneration();
            },
            construct() {
              return raiseDisabledCodeGeneration();
            }
          }));
          constructors.forEach((original, index) => {
            replaceValue(original.prototype, 'constructor', guardedConstructors[index]);
            if (index > 0) Object.setPrototypeOf(original, guardedConstructors[0]);
          });
          replaceValue(globalThis, 'eval', guardedEval);
          replaceValue(globalThis, 'Function', guardedConstructors[0]);
        }

        if (!allowWasm && typeof WebAssembly === 'object' && WebAssembly !== null) {
          const wasm = WebAssembly;
          const OriginalModule = wasm.Module;
          const CompileErrorCtor = wasm.CompileError || Error;
          const disabled = (api) => new CompileErrorCtor(
            api + '(): Wasm code generation disallowed by embedder'
          );
          const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
            ArrayBuffer.prototype,
            'byteLength'
          ).get;
          const sharedArrayBufferByteLength =
            typeof SharedArrayBuffer === 'undefined'
              ? undefined
              : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get;
          function isBackingStore(value) {
            if (typeof value !== 'object' || value === null) return false;
            try {
              arrayBufferByteLength.call(value);
              return true;
            } catch {
              if (!sharedArrayBufferByteLength) return false;
            }
            try {
              sharedArrayBufferByteLength.call(value);
              return true;
            } catch {
              return false;
            }
          }
          if (typeof OriginalModule === 'function') {
            const guardedModule = facade(OriginalModule, {
              apply(target, thisArg, args) {
                return Reflect.apply(target, thisArg, args);
              },
              construct() {
                throw disabled('WebAssembly.Module');
              }
            });
            replaceValue(OriginalModule.prototype, 'constructor', guardedModule);
            replaceValue(wasm, 'Module', guardedModule);
          }
          for (const api of ['compile', 'compileStreaming', 'instantiateStreaming']) {
            const original = wasm[api];
            if (typeof original !== 'function') continue;
            replaceValue(wasm, api, facade(original, {
              apply() {
                return Promise.reject(disabled('WebAssembly.' + api));
              }
            }));
          }
          if (typeof wasm.instantiate === 'function') {
            const originalInstantiate = wasm.instantiate;
            replaceValue(wasm, 'instantiate', facade(originalInstantiate, {
              apply(target, thisArg, args) {
                if (typeof OriginalModule === 'function' && args[0] instanceof OriginalModule) {
                  return Reflect.apply(target, thisArg, args);
                }
                const input = args[0];
                const isBufferSource = ArrayBuffer.isView(input) || isBackingStore(input);
                if (isBufferSource) {
                  return Promise.reject(disabled('WebAssembly.instantiate'));
                }
                return Reflect.apply(target, thisArg, args);
              }
            }));
          }
        }

        if (hasFacade) {
          const originalToString = Function.prototype.toString;
          const guardedToString = facade(originalToString, {
            apply(target, thisArg, args) {
              return Reflect.apply(target, facades.get(thisArg) || thisArg, args);
            }
          });
          replaceValue(Function.prototype, 'toString', guardedToString);
        }
      })();
    `,
    'vm.createContext.codeGeneration',
  );
}

function getOrCreateGuestRuntime(context: ContextObject): GuestRuntime {
  let rt = guestRuntimes.get(context);
  if (!rt) {
    const qctx = getQuickJsModuleSync().newContext();
    const membrane = new Membrane(qctx);
    applyCodeGenerationPolicy(qctx, context);
    rt = { qctx, membrane };
    guestRuntimes.set(context, rt);
    // GC'ing the ContextObject marks the controller pending → safe teardown once
    // wrapper-backed handles are clear. Held value is the controller (not the
    // ContextObject), unregister-token is the ContextObject so disposeContext can
    // cancel it before an explicit teardown.
    contextRegistry.register(context, membrane.lifetime, context);
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
  // the success and throw paths. The QuickJSContext stays alive after a throw;
  // `sweepContext` walks `ctx.global` and needs no completion handle, so it is safe
  // in finally.
  //
  // Error marshalling (T11): we do NOT use `unwrapResult` on the fail branch — it
  // throws a raw `QuickJSUnwrapError` (wrong cross-realm shape) AND disposes the
  // error handle. Instead we inspect the `{error}` handle ourselves, marshal it to
  // a host THROWABLE (`membrane.wrapGuestError` — a cross-realm error mirror, or
  // the raw primitive for a non-Error throw), dispose the handle ONCE here, then
  // `throw`. The wrapper retains its own internal dup, so disposing this completion
  // handle is safe. Symmetric with the success branch's dispose-after-marshal.
  try {
    // `SuccessOrFail` is `{value; error?:undefined} | {error}` — the success
    // variant also carries `error?:undefined`, so `'error' in result` cannot
    // narrow; discriminate on `error !== undefined` (then `error` is the handle).
    if (result.error !== undefined) {
      const errorHandle = result.error;
      let thrown: unknown;
      try {
        thrown = membrane.wrapGuestError(errorHandle);
      } finally {
        errorHandle.dispose();
      }
      throw thrown;
    }
    const handle = result.value;
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
      // The ContextObject GC finalizer is now redundant — cancel it (avoids a
      // second markPending on an already-pending/disposed controller).
      contextRegistry.unregister(context);
      // Mark pending rather than eagerly disposing: the controller tears the
      // QuickJSContext down ONLY when no wrapper-backed handle is live (each
      // wrapper finalizer decrements). Disposing while wrappers are alive would
      // abort the WASM runtime — so when wrappers outstand, teardown is deferred
      // until they are GC'd. Infra handles (id registry, seeds) are disposed by
      // the controller immediately before the actual `ctx.dispose()`.
      rt.membrane.lifetime.markPending();
    }
  },
};
