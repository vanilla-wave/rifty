/**
 * Two-way membrane between host + guest realms.
 *
 * Guest→host (T6): wrap guest completion values for the host.
 * Host→guest (T7 read path): seed the live contextObject INTO the guest.
 *
 * Wraps OBJECT / FUNCTION / ARRAY guest values so the host sees them with
 * Node-faithful cross-realm identity. Real Node returns vm completion objects
 * from the *guest* realm, so they fail `instanceof` against host constructors
 * while still being array-/object-/function-shaped. We reproduce that with host
 * Proxies whose `getPrototypeOf` trap returns `null` (cross-realm proto break)
 * and whose other traps route reads to the live guest handle.
 *
 * Verified Node oracle (parity case `vm/quickjs-returns-objects`):
 *   - array:    `instanceof Array` FALSE, `Array.isArray` TRUE, JSON/.map work.
 *   - object:   `constructor === Object` FALSE, `instanceof Object` FALSE,
 *               property reads + `Object.keys`/JSON work.
 *   - function: `typeof 'function'`, callable, `instanceof Function` FALSE.
 *
 * Wrapper designs (all empirically validated, see QUICKJS_API.md + the parity case):
 *   - ARRAY    → `Proxy(realHostArray, {getPrototypeOf:()=>null})`. The target is
 *                a REAL host array holding the recursively-marshalled elements, so
 *                `Array.isArray` is TRUE (it sees the array target) but the null
 *                proto makes `instanceof Array` FALSE; `.map`/JSON/indexing run off
 *                the target. (Snapshot semantics — element liveness/round-trip
 *                identity is revisited if a later parity case demands it; T7/T8.)
 *   - OBJECT   → `Proxy({}, traps)` over a FRESH EXTENSIBLE empty target. All
 *                property reads (incl. `constructor`) route through `ctx.getProp`
 *                to the guest handle and back through the membrane, so
 *                `obj.constructor` resolves to the *guest* Object constructor
 *                (wrapped → never `=== host Object`). `getPrototypeOf:()=>null`
 *                gives `instanceof Object` FALSE. `ownKeys`+`getOwnPropertyDescriptor`
 *                drive `Object.keys`/JSON. The target MUST stay extensible and the
 *                reported descriptors MUST be `configurable:true` — a non-extensible
 *                target + null proto, or a non-configurable descriptor over an empty
 *                target, violates a Proxy invariant and throws. Faithful
 *                frozen/non-configurable descriptor mirroring is T12.
 *   - FUNCTION → `Proxy(hostThunk, {getPrototypeOf:()=>null})`. The target is a host
 *                function (keeps the Proxy callable); the null proto makes
 *                `instanceof Function` FALSE. The `apply` path marshals host args →
 *                guest (primitives only for now — full host→guest object marshalling
 *                is T7), calls the guest fn, and marshals the result back.
 *
 * Host→guest read path (T7, `reseedContext`/`marshalHostToGuest`) — the MIRROR of
 * the outbound technique. A host array/object seen in the guest must be
 * `Array.isArray` TRUE (real guest brand) yet `instanceof Array`/`Object` FALSE
 * (cross-realm proto break). We build a REAL guest array/object holding the
 * recursively-marshalled elements, then sever its prototype in the guest
 * (`Object.setPrototypeOf(v, null)`) — same null-proto trick, in reverse.
 *
 * Bidirectional callables (T9, `#marshalInboundFunction` + `#wrapFunction`). A
 * HOST fn seeded into the guest becomes a `ctx.newFunction` whose impl marshals
 * the guest arg handles OUT (`wrapGuestToHost` — so a guest array arg is seen in
 * the host with the guest prototype, `instanceof hostArray` FALSE, #16), calls the
 * host fn, and marshals the host result back IN. A GUEST fn passed to such a host
 * fn marshals OUT through `#wrapFunction`, which DUPS+RETAINS the guest handle so
 * the host can store the callback and call it AFTER the synchronous run (the
 * QuickJSContext stays alive — Node has no vm-context teardown). Identity is
 * symmetric: same host fn → same guest fn (and round-trips back to the host fn);
 * same guest fn → same host wrapper. Inbound symbols are T10 (loud boundary).
 *
 * Write-back / reconciliation (T8, Option A — post-run sweep + per-run reseed).
 * vm runs are SYNCHRONOUS: the host cannot observe the sandbox DURING a run, so a
 * post-run reconciliation is observationally EQUIVALENT to a live contextObject
 * for synchronous code. We exploit that instead of live inbound Proxies (Option B,
 * which would retain a host trap fn per seeded object). Per run the engine calls:
 *   - `reseedContext` BEFORE: (re)sync each host key INTO the guest from CURRENT
 *     host state, so between-run host mutations are visible (`sb.v = 2` before the
 *     2nd run → guest reads 2). Host objects reuse the cached inbound seed (same
 *     guest identity) but their props are REFRESHED from the host. Seeds are
 *     normal WRITABLE globals so the guest can deep-mutate them.
 *   - `sweepContext` AFTER: walk the guest global's OWN ENUMERABLE keys
 *     (`Object.keys(global)` — the 61 intrinsics are non-enumerable, so this is
 *     exactly seeded keys + guest `var`/bare-assignment globals). For each key:
 *       · still a host-origin seed (id ∈ `#hostOrigins`) → RECURSE, writing nested
 *         guest changes INTO the original host object (deep write-back, e.g.
 *         `shared.count = 42`, `module.exports = {…}`); host slot stays the SAME
 *         reference.
 *       · otherwise (new global, or reassigned to a guest value) → write
 *         `wrapGuestToHost(value)` to `context[key]`. The identity cache makes the
 *         swept-back slot the SAME wrapper as a value the run also RETURNED, so
 *         `this.shared = {…}; this.shared` gives `ret === sb.shared` (#21).
 * Sweep-after + reseed-before keeps host & guest consistent: by the next reseed the
 * host already reflects the prior run's guest writes, so reseed-from-host never
 * clobbers them.
 *
 * Residual divergence (documented, NOT silent; not covered by the 27 probes): if
 * the host STRUCTURALLY removes a key from a *host object* (not the top-level
 * context) between runs, reseed overwrites/adds but does not delete the stale guest
 * prop. Top-level key add/remove + all primitive/value refresh ARE faithful. A
 * guest callback held by the host CAN be called after the sync run (T9 — the
 * handle survives); side effects it makes on a seeded sandbox object are seen by
 * the host only at the NEXT sync reconciliation (no live inbound write-through —
 * Option A, see above), matching the sync-equivalence model.
 *
 * Round-trip identity (#14): a host object marshalled IN then returned OUT must
 * be the SAME host reference. We track host origin by the guest object's STABLE
 * ID (see `#idOf` below) — when seeding a host object in we record
 * `#hostOrigins.set(idOf(seed), originalHostObject)`; `wrapGuestToHost` computes
 * `idOf(handle)` and, if it is a known host-origin id, returns the original. NO
 * guest-visible / guest-writable marker is carried on the seed, so guest code
 * CANNOT forge a host reference (it has no reference to the id registry — see
 * `#idOf`) and the seed carries no membrane-visible own symbol
 * (`Object.getOwnPropertySymbols(seed)` is empty, matching real Node). Inbound
 * identity is also cached host-side (`WeakMap<hostObject, guestSeedHandle>`) so
 * the same host object always seeds the SAME guest value.
 *
 * Identity / host-origin registry (`#idOf`): handles are NOT stable Map keys
 * (`ctx.eq` only, QUICKJS_API.md), so the SAME guest object would otherwise yield
 * DIFFERENT host wrappers AND host-origin lookups. We eval a tiny id registry as
 * a CLOSURE that hands out a stable numeric id per guest object via a guest
 * `WeakMap`, and RETAIN the closure's function handle HOST-SIDE only — it is
 * NEVER `setProp`-ed onto the guest global, so guest code has no reference to the
 * WeakMap and cannot pre-seed an id, read the registry, or otherwise influence
 * identity. The host keys both `#wrappers: Map<id, hostWrapper>` and
 * `#hostOrigins: Map<id, hostObject>` on it. Chosen over the O(n) `ctx.eq` scan
 * for O(1) lookup and because it works on frozen guest objects (a WeakMap does
 * not mutate them, unlike tagging a hidden property). Trade-off: each tracked
 * guest object is retained by the guest WeakMap for the context's life — bounded
 * by the {@link ContextLifetime} controller (the whole guest WeakMap goes when the
 * context is torn down).
 *
 * Disposal / handle lifetime (T9, {@link ContextLifetime}): every WRAPPER-backed
 * guest handle is registered in a FinalizationRegistry — when the host GC's the
 * wrapper, its guest handle is disposed and the identity-cache entry evicted, so
 * growth is BOUNDED (a wrapper no host code holds frees its handle). INFRASTRUCTURE
 * handles (the id registry closure + inbound seeds + inbound host-fn handles) live
 * for the context's life and are disposed only at teardown. TRANSIENT handles in a
 * trap/callback are disposed immediately (Scope / explicit). The QuickJSContext is
 * disposed ONLY when it is pending-dispose AND no wrapper-backed handle is live
 * (refcount, NOT finalizer ordering), so `ctx.dispose()` never trips the
 * leaked-handle abort. Normal runs NEVER dispose the context (Node has no
 * vm-context teardown — the realm lives until GC).
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import { Scope } from 'quickjs-emscripten-core';
import { ContextLifetime } from './context-lifetime.ts';

/**
 * Guest id registry as an UNREACHABLE closure. Evaluates to a function that maps
 * each guest object → a stable numeric id via a private `WeakMap`. The host
 * RETAINS the returned function handle and NEVER `setProp`s it onto the guest
 * global, so guest code cannot reach `m`/the function — it cannot pre-seed an id,
 * read the registry, or influence host-origin identity. (Contrast: the prior
 * `globalThis[Symbol.for('rifty.vm.idOf')]` form was reachable + writable from
 * guest, re-enabling forgery.)
 */
const ID_REGISTRY_BOOTSTRAP = `
(() => {
  const m = new WeakMap();
  let next = 0;
  return (o) => {
    let id = m.get(o);
    if (id === undefined) { id = ++next; m.set(o, id); }
    return id;
  };
})();
`;

export class Membrane {
  readonly #ctx: QuickJSContext;
  /**
   * guest object id → a WEAK ref to its single host wrapper (identity cache).
   * WeakRef so the cache does NOT pin the wrapper — otherwise the wrapper would
   * never be GC'd and its FinalizationRegistry cleanup (which frees the backing
   * guest handle) would never fire, defeating the bound on growth (T9). A
   * collected wrapper derefs to `undefined` → cache MISS → rebuild (the
   * controller's finalizer also evicts the stale entry).
   */
  readonly #wrappers = new Map<number, WeakRef<object>>();
  /**
   * Handle-lifetime controller (T9): tracks wrapper-backed handles under a
   * FinalizationRegistry (GC a wrapper → dispose its guest handle, bounding
   * growth) and infrastructure handles (id registry, inbound seeds), and disposes
   * the QuickJSContext ONLY when it is pending AND no wrapper-backed handle is
   * live — so `ctx.dispose()` never trips the leaked-handle abort. See
   * `context-lifetime.ts`.
   */
  readonly #lifetime: ContextLifetime;
  #idOfHandle: QuickJSHandle | undefined;

  // --- Inbound (host→guest) bidirectional identity cache (T7 read path) ---
  /** host object/array/fn → its single seeded guest handle (inbound identity). */
  readonly #inboundGuest = new WeakMap<object, QuickJSHandle>();
  /** guest id (of the seed) → ORIGINAL host object, for the round-trip OUT (#14). */
  readonly #hostOrigins = new Map<number, object>();
  /**
   * OUT wrapper → the guest handle it wraps (the REVERSE of `wrapGuestToHost`).
   * When such a wrapper is marshalled back INTO the guest (T8 reseed of a value a
   * prior run returned, e.g. `this.shared = {…}` then a later run), we must hand
   * the guest back its OWN object — not build a fresh inbound seed and then try to
   * WRITE through the wrapper on the next sweep (which the wrapper rejects). Keyed
   * (weakly) by the wrapper object; the handle is the SAME dup the wrapper already
   * retains (tracked by the lifetime controller), so no extra lifetime.
   */
  readonly #outWrapperGuest = new WeakMap<object, QuickJSHandle>();

  constructor(ctx: QuickJSContext) {
    this.#ctx = ctx;
    // Evict the identity-cache entry when a wrapper's handle is released. The
    // wrapper arg is present only on the EXPLICIT path (`releaseWrapper`, wrapper
    // still alive but its handle now dead) — delete if the stored ref points to
    // THIS wrapper or is dead. On the GC path (no wrapper — held values must not
    // pin the target) delete only if the stored ref is already dead, so a fresh
    // wrapper that replaced a collected one (same id) is not clobbered.
    this.#lifetime = new ContextLifetime(ctx, (id, wrapper) => {
      const current = this.#wrappers.get(id)?.deref();
      if (current === undefined || current === wrapper) this.#wrappers.delete(id);
    });
  }

  /** Handle-lifetime controller (engine wires the ContextObject finalizer to it). */
  get lifetime(): ContextLifetime {
    return this.#lifetime;
  }

  /**
   * Stable numeric id for a guest object handle (lazy-installs the guest
   * registry). The registry is an UNREACHABLE closure — its function handle is
   * RETAINED host-side and NEVER exposed on the guest global, so guest code can
   * neither read nor pre-seed ids (see `ID_REGISTRY_BOOTSTRAP`).
   */
  #idOf(handle: QuickJSHandle): number {
    if (!this.#idOfHandle) {
      const ctx = this.#ctx;
      this.#idOfHandle = ctx.unwrapResult(ctx.evalCode(ID_REGISTRY_BOOTSTRAP));
      this.#lifetime.trackInfra(this.#idOfHandle);
    }
    return Scope.withScope((scope) => {
      const result = scope.manage(
        this.#ctx.unwrapResult(
          this.#ctx.callFunction(this.#idOfHandle as QuickJSHandle, this.#ctx.undefined, handle),
        ),
      );
      return this.#ctx.getNumber(result);
    });
  }

  /**
   * Marshal a guest handle to a host value. PRIMITIVES are returned directly;
   * OBJECT / ARRAY / FUNCTION are wrapped (identity-cached). The caller still owns
   * `handle` — this never disposes it (objects/functions retain a DUP internally).
   */
  wrapGuestToHost(handle: QuickJSHandle): unknown {
    const ctx = this.#ctx;
    const kind = ctx.typeof(handle);
    switch (kind) {
      case 'undefined':
        return undefined;
      case 'number':
        return ctx.getNumber(handle);
      case 'string':
        return ctx.getString(handle);
      case 'boolean':
        return ctx.dump(handle) as boolean;
      case 'bigint':
        return ctx.dump(handle) as bigint;
      case 'symbol':
        // Symbol completion values are exotic mirroring — T10.
        throw new Error('vm: symbol marshalling not implemented (Task 10)');
      case 'function': {
        // Compute the guest id ONCE — reused for the host-origin round-trip
        // check and the wrapper identity cache. NO guest property is read, so
        // guest code cannot forge a host reference.
        const id = this.#idOf(handle);
        const origin = this.#hostOrigins.get(id);
        if (origin !== undefined) return origin;
        return this.#wrapCached(id, () => this.#wrapFunction(handle, id));
      }
      case 'object': {
        // null is typeof 'object' in QuickJS too — distinguish via dump (reliable
        // for null per QUICKJS_API.md).
        if (ctx.dump(handle) === null) return null;
        const id = this.#idOf(handle);
        // Round-trip identity (#14): a guest value whose id is a known host-origin
        // is one we marshalled IN — return the ORIGINAL host object. The id comes
        // from the unreachable registry, never a guest-readable/writable marker.
        const origin = this.#hostOrigins.get(id);
        if (origin !== undefined) return origin;
        if (this.#isArray(handle)) {
          return this.#wrapCached(id, () => this.#wrapArray(handle, id));
        }
        return this.#wrapCached(id, () => this.#wrapObject(handle, id));
      }
      default:
        throw new Error(`vm: ${kind} marshalling not implemented (Task 6)`);
    }
  }

  /**
   * Host→guest marshaller (T7 read path). PRIMITIVES become guest values by
   * value; OBJECT/ARRAY become a host-origin guest seed (identity cached, so the
   * same host object → the same guest value). The returned handle is OWNED by the
   * caller — for cached objects/arrays it is a `dup` of the retained seed;
   * primitives are fresh/constant per the existing convention.
   *
   * The seed is a WRITABLE guest object the guest may deep-mutate; T8's post-run
   * `sweepContext` reconciles those mutations back to the host. Host FUNCTION
   * marshalling (a genuine HOST function entering the guest) is T9 — loud boundary
   * here — EXCEPT an OUT wrapper round-tripping back IN: that recovers the
   * original guest handle (`#outWrapperGuest`), so a guest value a prior run
   * returned and the host stored back is seen by the next run as its own object.
   */
  marshalHostToGuest(value: unknown): QuickJSHandle {
    const ctx = this.#ctx;
    // OUT wrapper round-trip (covers object/array/function): hand the guest back
    // its OWN handle. Must precede both the inbound-seed and the function-boundary
    // throw — a wrapped guest fn is `typeof 'function'` but is NOT a host fn.
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      const guest = this.#outWrapperGuest.get(value as object);
      if (guest) return guest.dup();
    }
    switch (typeof value) {
      case 'undefined':
        return ctx.undefined;
      case 'number':
        return ctx.newNumber(value);
      case 'string':
        return ctx.newString(value);
      case 'boolean':
        return value ? ctx.true : ctx.false;
      case 'bigint':
        return ctx.newBigInt(value);
      case 'object': {
        if (value === null) return ctx.null;
        return this.#marshalInboundObject(value);
      }
      case 'function':
        // A genuine HOST function entering the guest (guest-callable host fn, T9).
        return this.#marshalInboundFunction(value as (...args: unknown[]) => unknown);
      default:
        // symbol host→guest is exotic mirroring — T10.
        throw new Error(`vm: host→guest ${typeof value} marshalling not implemented (Task 10)`);
    }
  }

  /**
   * Marshal a host object/array INTO the guest as a host-origin seed. Returns a
   * `dup` of the cached seed (caller owns it). The inbound identity cache keeps
   * ONE seed per host object (so re-marshalling yields the same guest value and
   * the round-trip OUT recovers this host object, #14) — but on a cache HIT the
   * seed's props are REFRESHED from the host so between-run host mutations (T8)
   * are visible to the next run. Host origin is recorded by the seed's
   * UNFORGEABLE registry id — NO guest-visible marker is written.
   */
  #marshalInboundObject(value: object): QuickJSHandle {
    const cached = this.#inboundGuest.get(value);
    if (cached) {
      // Between-run refresh: overwrite seed props from current host state so a
      // host mutation since the last seed is reflected. Same guest object →
      // identity + host-origin id preserved. (Structural key REMOVAL on a host
      // object is the documented residual — overwrite/add only; see file doc.)
      this.#populateSeed(cached, value);
      return cached.dup();
    }
    const ctx = this.#ctx;
    const isArray = Array.isArray(value);
    // Build the seed. The seed handle is RETAINED (it backs the live seeded
    // global); the returned dup is the caller's to dispose.
    const seed = isArray ? ctx.newArray() : ctx.newObject();
    this.#populateSeed(seed, value);
    // Record host-origin keyed by the seed's UNFORGEABLE registry id (NOT a
    // guest-written marker) so the round-trip OUT returns the exact same host
    // reference. `#idOf` assigns a fresh id to this never-before-seen seed.
    this.#hostOrigins.set(this.#idOf(seed), value);
    // Sever the prototype: a host array seen in the guest is `Array.isArray`
    // TRUE (real guest array brand) but `instanceof Array` FALSE (proto is not
    // the guest Array.prototype) — mirrors the OUTBOUND null-proto technique.
    this.#severPrototype(seed);
    this.#inboundGuest.set(value, seed);
    // Seeds live for the context's life (the seeded global keeps a dup; the host
    // object may be re-marshalled any run) — track as infra, disposed at teardown.
    this.#lifetime.trackInfra(seed);
    return seed.dup();
  }

  /**
   * Marshal a genuine HOST function INTO the guest as a guest-callable function
   * (T9). Builds `ctx.newFunction(name, cb)`: when the guest calls it, `cb` gets
   * the guest arg handles (owned by the call frame, auto-disposed on return); we
   * marshal each OUT via `wrapGuestToHost` (so a guest array arg is seen in the
   * host with the guest prototype → `instanceof hostArray` FALSE, #16), call the
   * host fn, and marshal the host result back IN via `marshalHostToGuest`.
   *
   * Identity: the same host fn → the SAME guest fn handle (`#inboundGuest` cache,
   * shared with objects/arrays). Host-origin is recorded by the guest fn's
   * registry id, so the round-trip OUT (`wrapGuestToHost` of this guest fn)
   * recovers the ORIGINAL host fn (reuses the `case 'function'` origin check).
   *
   * The guest fn handle is RETAINED as infra (it backs the seeded global / may be
   * re-marshalled any run); the returned dup is the caller's. Guest CALLBACK args
   * (a guest fn passed to this host fn, e.g. `keep(cb)`) marshal OUT through
   * `#wrapFunction`, which DUPS+RETAINS the guest handle so the host can call the
   * wrapper AFTER the synchronous run.
   */
  #marshalInboundFunction(fn: (...args: unknown[]) => unknown): QuickJSHandle {
    const cached = this.#inboundGuest.get(fn);
    if (cached) return cached.dup();
    const ctx = this.#ctx;
    const name = typeof fn.name === 'string' ? fn.name : '';
    const guestFn = ctx.newFunction(name, (...argHandles: QuickJSHandle[]): QuickJSHandle => {
      // argHandles are owned by the call frame (auto-disposed on return).
      // `wrapGuestToHost` never disposes its arg and dups internally for
      // objects/functions (so a guest callback survives the run), so we read them
      // directly without managing disposal here.
      const args = argHandles.map((h) => this.wrapGuestToHost(h));
      const result = fn(...args);
      const resultH = this.marshalHostToGuest(result);
      // newFunction consumes the returned handle; context constants are
      // context-owned and must NOT be handed over — return a fresh owned dup.
      return this.#isContextConstant(resultH) ? resultH.dup() : resultH;
    });
    // Host-origin by the guest fn's unforgeable id → round-trip OUT recovers `fn`.
    this.#hostOrigins.set(this.#idOf(guestFn), fn);
    this.#inboundGuest.set(fn, guestFn);
    // The guest fn handle lives for the context's life (seeded global / re-marshal).
    this.#lifetime.trackInfra(guestFn);
    return guestFn.dup();
  }

  /** Set each own enumerable host key onto the guest seed (recursive marshal). */
  #populateSeed(seed: QuickJSHandle, value: object): void {
    const ctx = this.#ctx;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const elem = this.marshalHostToGuest(value[i]);
        try {
          ctx.setProp(seed, i, elem);
        } finally {
          if (!this.#isContextConstant(elem)) elem.dispose();
        }
      }
      return;
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const elem = this.marshalHostToGuest((value as Record<string, unknown>)[key]);
      try {
        ctx.setProp(seed, key, elem);
      } finally {
        if (!this.#isContextConstant(elem)) elem.dispose();
      }
    }
  }

  /** `Object.setPrototypeOf(handle, null)` in the guest. */
  #severPrototype(handle: QuickJSHandle): void {
    const ctx = this.#ctx;
    Scope.withScope((scope) => {
      const objectCtor = scope.manage(ctx.getProp(ctx.global, 'Object'));
      const setProto = scope.manage(ctx.getProp(objectCtor, 'setPrototypeOf'));
      ctx.unwrapResult(ctx.callFunction(setProto, ctx.undefined, handle, ctx.null)).dispose();
    });
  }

  /**
   * (Re)sync the LIVE contextObject INTO the guest realm BEFORE each run (T7 read
   * path + T8 between-run re-sync). Each own enumerable host key becomes readable
   * in the guest: primitives by value; host objects/arrays via the cached
   * host-origin seed (`#marshalInboundObject` refreshes its props from the
   * current host on a cache hit, so a host mutation since the last run is
   * visible). Seeded as normal WRITABLE globals (`setProp`, not `defineProp`) so
   * the guest can deep-mutate / reassign them — matching Node's contextified
   * global. Guest writes are reconciled back AFTER the run by `sweepContext`.
   */
  reseedContext(context: Record<string, unknown>): void {
    const ctx = this.#ctx;
    for (const key of Object.keys(context)) {
      const valueH = this.marshalHostToGuest(context[key]);
      try {
        ctx.setProp(ctx.global, key, valueH);
      } finally {
        if (!this.#isContextConstant(valueH)) valueH.dispose();
      }
    }
  }

  /**
   * Reconcile guest writes back to the host contextObject AFTER a run (T8).
   * Walks the guest global's OWN ENUMERABLE keys (`Object.keys(global)` — the
   * intrinsics are non-enumerable, so this is exactly the seeded keys + any guest
   * `var`/bare-assignment globals). For each key:
   *   - if it still holds a host-origin seed → RECURSE into the seed, writing
   *     nested guest changes INTO the original host object (deep write-back); the
   *     host slot keeps the SAME reference.
   *   - otherwise (new global, or reassigned to a guest value) → write the
   *     marshalled-out value. The OUT identity cache makes this the SAME wrapper
   *     as a value the run also returned (`ret === sb.shared`, #21).
   */
  sweepContext(context: Record<string, unknown>): void {
    const ctx = this.#ctx;
    for (const key of this.#ownEnumerableKeys(ctx.global)) {
      const guestVal = ctx.getProp(ctx.global, key);
      try {
        const origin = this.#originOf(guestVal);
        if (origin !== undefined) {
          this.#sweepInto(guestVal, origin);
          context[key] = origin;
        } else {
          context[key] = this.wrapGuestToHost(guestVal);
        }
      } finally {
        guestVal.dispose();
      }
    }
  }

  /**
   * Write the guest object's own-enumerable props INTO the host object it seeds.
   * Primitives/fresh guest values go through the OUT membrane; a nested prop that
   * is itself a host-origin seed recurses (so the host slot stays the same
   * reference and deep mutations land on the original host object).
   */
  #sweepInto(guestSeed: QuickJSHandle, host: object): void {
    const ctx = this.#ctx;
    const target = host as Record<string, unknown>;
    for (const key of this.#ownEnumerableKeys(guestSeed)) {
      const childH = ctx.getProp(guestSeed, key);
      try {
        const origin = this.#originOf(childH);
        if (origin !== undefined) {
          this.#sweepInto(childH, origin);
          target[key] = origin;
        } else {
          target[key] = this.wrapGuestToHost(childH);
        }
      } finally {
        childH.dispose();
      }
    }
  }

  /**
   * If the guest handle is an OBJECT/FUNCTION whose registry id is a known
   * host-origin (a seed we marshalled IN), return that original host object —
   * else undefined. Primitives never have a host origin. The id comes from the
   * unreachable registry, so this cannot be forged by guest code.
   */
  #originOf(handle: QuickJSHandle): object | undefined {
    const kind = this.#ctx.typeof(handle);
    if (kind !== 'object' && kind !== 'function') return undefined;
    if (kind === 'object' && this.#ctx.dump(handle) === null) return undefined;
    return this.#hostOrigins.get(this.#idOf(handle));
  }

  /**
   * Own ENUMERABLE keys of a guest object (mirrors `Object.keys`): string keys +
   * numeric array indices rendered as strings (`numbersAsStrings` — so a host
   * array seed's indices sweep back too). Symbol keys excluded (T10).
   */
  #ownEnumerableKeys(handle: QuickJSHandle): string[] {
    const ctx = this.#ctx;
    return Scope.withScope((scope) => {
      const names = scope.manage(
        ctx
          .getOwnPropertyNames(handle, {
            strings: true,
            numbersAsStrings: true,
            onlyEnumerable: true,
          })
          .unwrap(),
      );
      return names.map((k) => ctx.getString(k));
    });
  }

  /**
   * Identity-cache wrapper: same guest object id → same host wrapper (within its
   * lifetime). `id` is the precomputed `#idOf`. The cache holds a WEAK ref so a
   * collected wrapper does not pin its guest handle; a dead/collected ref is a
   * MISS and `make()` (which calls `#lifetime.trackWrapper`, re-storing the ref)
   * rebuilds. `make()` MUST return an object (every wrapper is a Proxy).
   */
  #wrapCached(id: number, make: () => unknown): unknown {
    const existing = this.#wrappers.get(id)?.deref();
    if (existing !== undefined) return existing;
    const wrapper = make() as object;
    this.#wrappers.set(id, new WeakRef(wrapper));
    return wrapper;
  }

  /**
   * Retain a dup of the guest handle so the wrapper's traps stay valid, and
   * register the wrapper with the lifetime controller so GC'ing the wrapper
   * disposes this dup (bounding growth) and evicts the identity-cache entry.
   */
  #retainForWrapper(wrapper: object, handle: QuickJSHandle, id: number): QuickJSHandle {
    const dup = handle.dup();
    this.#lifetime.trackWrapper(wrapper, dup, id);
    return dup;
  }

  /** True if the guest handle is an Array (via guest `Array.isArray`). */
  #isArray(handle: QuickJSHandle): boolean {
    const ctx = this.#ctx;
    return Scope.withScope((scope) => {
      const arrayCtor = scope.manage(ctx.getProp(ctx.global, 'Array'));
      const isArrayFn = scope.manage(ctx.getProp(arrayCtor, 'isArray'));
      const result = scope.manage(
        ctx.unwrapResult(ctx.callFunction(isArrayFn, ctx.undefined, handle)),
      );
      return ctx.dump(result) === true;
    });
  }

  /**
   * ARRAY wrapper — Proxy over a REAL host array (so `Array.isArray` TRUE) with a
   * null proto (so `instanceof Array` FALSE). Elements are recursively marshalled
   * (snapshot). The guest handle is retained for future liveness work (T7/T8).
   */
  #wrapArray(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const guest = handle.dup();
    const length = ctx.getLength(handle) ?? 0;
    const target: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const elem = ctx.getProp(handle, i);
      try {
        target.push(this.wrapGuestToHost(elem));
      } finally {
        elem.dispose();
      }
    }
    const wrapper = new Proxy(target, { getPrototypeOf: () => null });
    // Remember the guest handle so re-marshalling this wrapper INTO the guest
    // (T8 reseed) recovers the original guest object instead of seeding a copy.
    this.#outWrapperGuest.set(wrapper, guest);
    // GC'ing the wrapper disposes `guest` + evicts the cache entry (T9).
    this.#lifetime.trackWrapper(wrapper, guest, id);
    return wrapper;
  }

  /**
   * OBJECT wrapper — Proxy over a fresh EXTENSIBLE empty target. Reads route to the
   * guest handle via `ctx.getProp` (incl. `constructor` → guest Object ctor wrapped
   * → `!== host Object`); null proto → `instanceof Object` FALSE; ownKeys +
   * getOwnPropertyDescriptor drive `Object.keys`/JSON. Descriptors are reported
   * `configurable:true` to satisfy Proxy invariants over an empty target (faithful
   * frozen/non-config mirroring is T12).
   */
  #wrapObject(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const guest = handle.dup();
    const membrane = this;
    const target: Record<PropertyKey, unknown> = {};

    const ownStringKeys = (): string[] => {
      return Scope.withScope((scope) => {
        const names = scope.manage(ctx.getOwnPropertyNames(guest).unwrap());
        return names.map((k) => ctx.getString(k));
      });
    };

    const wrapper = new Proxy(target, {
      getPrototypeOf: () => null,
      get(_t, key) {
        if (typeof key === 'symbol') return undefined; // symbol keys are T10
        const valueH = ctx.getProp(guest, key);
        try {
          return membrane.wrapGuestToHost(valueH);
        } finally {
          valueH.dispose();
        }
      },
      has(_t, key) {
        if (typeof key === 'symbol') return false;
        return ownStringKeys().includes(key);
      },
      ownKeys() {
        return ownStringKeys();
      },
      getOwnPropertyDescriptor(_t, key) {
        if (typeof key === 'symbol') return undefined;
        if (!ownStringKeys().includes(key)) return undefined;
        const valueH = ctx.getProp(guest, key);
        let value: unknown;
        try {
          value = membrane.wrapGuestToHost(valueH);
        } finally {
          valueH.dispose();
        }
        // configurable:true REQUIRED over an empty target (Proxy invariant). T12
        // reconstructs the real writable/enumerable/configurable flags.
        return { value, writable: true, enumerable: true, configurable: true };
      },
      set() {
        // Host MUTATING a returned guest-realm object (live host→guest write on
        // an OUT wrapper) is distinct from T8's contextObject write-back (which
        // reconciles GUEST writes back to the host). Live OUT-wrapper mutation is
        // bidirectional-liveness — T9. Loud boundary.
        throw new Error('vm: host write to returned guest object not implemented (Task 9)');
      },
      deleteProperty() {
        throw new Error('vm: host delete on returned guest object not implemented (Task 9)');
      },
    });
    // Remember the guest handle so re-marshalling this wrapper INTO the guest
    // (T8 reseed) recovers the original guest object instead of seeding a copy.
    this.#outWrapperGuest.set(wrapper, guest);
    // GC'ing the wrapper disposes `guest` + evicts the cache entry (T9).
    this.#lifetime.trackWrapper(wrapper, guest, id);
    return wrapper;
  }

  /**
   * FUNCTION wrapper — callable Proxy over a host thunk (target stays a function so
   * the Proxy is callable) with a null proto (so `instanceof Function` FALSE). The
   * thunk marshals host args → guest (primitives + objects/arrays + host fns via
   * `marshalHostToGuest`), calls the guest fn, and marshals the result back. The
   * guest handle is DUP+RETAINED so the host can call the wrapper AFTER the run —
   * e.g. a guest callback passed to a host fn and stored (`keep(cb); stored()`).
   */
  #wrapFunction(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const guest = handle.dup();

    const thunk = (...args: unknown[]): unknown => {
      return Scope.withScope((scope) => {
        const argHandles = args.map((a) => {
          const h = this.marshalHostToGuest(a);
          // Context constants (undefined/null/true/false) are context-owned — never
          // manage them for disposal; only manage freshly-created arg handles.
          return this.#isContextConstant(h) ? h : scope.manage(h);
        });
        const ret = scope.manage(
          ctx.unwrapResult(ctx.callFunction(guest, ctx.undefined, ...argHandles)),
        );
        return this.wrapGuestToHost(ret);
      });
    };

    const wrapper = new Proxy(thunk, { getPrototypeOf: () => null });
    // Remember the guest handle so re-marshalling this wrapper INTO the guest
    // (T8 reseed) recovers the original guest function instead of throwing on the
    // host→guest function boundary (T9).
    this.#outWrapperGuest.set(wrapper, guest);
    // GC'ing the wrapper disposes `guest` + evicts the cache entry. While the host
    // HOLDS the wrapper (e.g. `stored = cb`), the dup stays alive, so calling it
    // AFTER the run does `callFunction` on a still-valid handle (T9).
    this.#lifetime.trackWrapper(wrapper, guest, id);
    return wrapper;
  }

  /** True for context-owned constant handles that must NOT be disposed. */
  #isContextConstant(handle: QuickJSHandle): boolean {
    const ctx = this.#ctx;
    return (
      handle === ctx.undefined ||
      handle === ctx.null ||
      handle === ctx.true ||
      handle === ctx.false ||
      handle === ctx.global
    );
  }
}
