/**
 * Per-context handle-lifetime controller — the GC net for the membrane (T9).
 *
 * Problem (QUICKJS_API.md): `ctx.dispose()` ABORTS the whole WASM runtime if ANY
 * guest handle is still alive. The membrane RETAINS a guest handle behind every
 * cross-realm wrapper (object/array/function Proxy) and behind its infrastructure
 * (the id-registry closure + inbound seeds). Eagerly disposing the context while
 * those are alive would abort; never disposing leaks.
 *
 * Design — refcount + two FinalizationRegistries, NO ordering assumption:
 *   - Every WRAPPER-backed guest handle is registered in {@link wrapperRegistry}.
 *     When the host GC's the wrapper, the finalizer disposes that handle and
 *     decrements {@link #live}. This BOUNDS growth: a wrapper no host code holds
 *     frees its guest handle.
 *   - INFRASTRUCTURE handles (id registry, inbound seeds) live for the context's
 *     life; they are tracked separately ({@link #infra}) and disposed only at the
 *     very end, immediately before `ctx.dispose()`.
 *   - The vm.Context (ContextObject) is registered in {@link contextRegistry} by
 *     the engine. When it is GC'd the finalizer calls {@link markPending}.
 *
 * The context is disposed ONLY when BOTH (a) it is pending-dispose AND (b) the
 * live wrapper count is 0 — i.e. no wrapper-backed handle is outstanding. At that
 * moment the ONLY alive handles are the infra ones, which {@link #disposeNow}
 * disposes first, so `ctx.dispose()` never sees a live handle → never aborts.
 * FinalizationRegistry gives NO ordering guarantees, so we rely on the refcount,
 * never on "wrappers finalize before the context".
 *
 * The controller is referenced by BOTH registries' held values (a wrapper held
 * value carries `{ controller, handle, id }`; the context held value carries the
 * controller), so it OUTLIVES the membrane it belongs to — when the ContextObject
 * is GC'd the membrane becomes garbage too, but the controller (and the handles
 * it must still dispose) stays reachable until teardown completes.
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';

/** Held value for a wrapper-backed handle finalizer. Must NOT reference the wrapper (target). */
interface WrapperFinalizerEntry {
  readonly controller: ContextLifetime;
  readonly handle: QuickJSHandle;
  /** Guest-object id, so the controller can evict the wrapper from the identity cache. */
  readonly id: number;
}

export class ContextLifetime {
  readonly #ctx: QuickJSContext;
  /** Live wrapper-backed handle count. Context disposes only when this is 0 + pending. */
  #live = 0;
  /** Context marked for disposal (ContextObject GC'd or explicit disposeContext). */
  #pending = false;
  /** Already disposed — guard against double `ctx.dispose()` (would also abort). */
  #disposed = false;
  /** Infrastructure handles (id registry, inbound seeds) — disposed last, at teardown. */
  readonly #infra: QuickJSHandle[] = [];
  /**
   * Evicts a wrapper's identity-cache entry when its handle is released. The
   * second arg is the wrapper on the EXPLICIT release path (`releaseWrapper`) and
   * `undefined` on the GC path (finalizer held values must not pin the wrapper).
   */
  readonly #evict: (id: number, wrapper?: object) => void;
  /**
   * wrapper → its tracked entry, for EXPLICIT release ({@link releaseWrapper})
   * without waiting for GC. WeakMap key, so it does NOT pin the wrapper (GC still
   * works — the FinalizationRegistry remains the production reclaim path).
   */
  readonly #entries = new WeakMap<object, WrapperFinalizerEntry>();

  /**
   * Disposes a wrapper's guest handle + decrements the live count when the host
   * GC's the wrapper. Keyed by the wrapper object (the target passed to register).
   */
  readonly wrapperRegistry: FinalizationRegistry<WrapperFinalizerEntry>;

  constructor(ctx: QuickJSContext, evict: (id: number, wrapper?: object) => void) {
    this.#ctx = ctx;
    this.#evict = evict;
    this.wrapperRegistry = new FinalizationRegistry<WrapperFinalizerEntry>((entry) => {
      // GC path: no wrapper (the held value must not reference it, or it would
      // never be collected). The cache evictor drops the entry iff still stale.
      entry.controller.#onWrapperReleased(entry, undefined);
    });
  }

  /** The guest context this controller guards. */
  get ctx(): QuickJSContext {
    return this.#ctx;
  }

  /** True once the context has been torn down (handles + `ctx.dispose()`). */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Current live wrapper-backed handle count (test/diagnostic). */
  get liveWrapperCount(): number {
    return this.#live;
  }

  /**
   * Track a wrapper-backed guest handle: increment the live count and register a
   * finalizer on `wrapper` so GC'ing the wrapper disposes `handle` (and evicts the
   * identity-cache entry for `id`). The membrane RETAINS `handle` itself; this only
   * arranges for its eventual disposal.
   */
  trackWrapper(wrapper: object, handle: QuickJSHandle, id: number): void {
    this.#live++;
    const entry: WrapperFinalizerEntry = { controller: this, handle, id };
    this.#entries.set(wrapper, entry);
    this.wrapperRegistry.register(wrapper, entry, wrapper);
  }

  /**
   * Explicitly release a still-tracked wrapper's guest handle NOW (instead of
   * waiting for GC): dispose the handle, evict the cache entry, decrement the live
   * count, unregister the finalizer, and tear the context down if that was the
   * last live wrapper + the context is pending. Idempotent (no-op if untracked).
   * Used by deterministic tests; also a hook should the engine ever proactively
   * release wrappers it knows are dead.
   */
  releaseWrapper(wrapper: object): void {
    const entry = this.#entries.get(wrapper);
    if (!entry) return;
    this.#entries.delete(wrapper);
    this.wrapperRegistry.unregister(wrapper);
    this.#onWrapperReleased(entry, wrapper);
  }

  /** Track an infrastructure handle (id registry / inbound seed) — disposed at teardown only. */
  trackInfra(handle: QuickJSHandle): void {
    this.#infra.push(handle);
  }

  /** Mark the context for disposal; tear it down now if no wrapper-backed handle is live. */
  markPending(): void {
    this.#pending = true;
    this.#maybeDispose();
  }

  #onWrapperReleased(entry: WrapperFinalizerEntry, wrapper: object | undefined): void {
    if (entry.handle.alive) entry.handle.dispose();
    this.#evict(entry.id, wrapper);
    this.#live--;
    this.#maybeDispose();
  }

  /** Dispose iff pending AND no wrapper-backed handle remains live. */
  #maybeDispose(): void {
    if (this.#disposed || !this.#pending || this.#live > 0) return;
    this.#disposeNow();
  }

  /**
   * Final teardown: dispose every infra handle FIRST (the only handles still alive
   * once live wrapper count is 0), THEN `ctx.dispose()`. After this the live set is
   * empty, so the dispose never trips the leaked-handle abort.
   */
  #disposeNow(): void {
    for (const h of this.#infra) {
      if (h.alive) h.dispose();
    }
    this.#infra.length = 0;
    this.#ctx.dispose();
    this.#disposed = true;
  }
}
