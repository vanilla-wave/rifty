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
 * Host→guest read path (T7, `seedContext`/`marshalHostToGuest`) — the MIRROR of
 * the outbound technique. A host array/object seen in the guest must be
 * `Array.isArray` TRUE (real guest brand) yet `instanceof Array`/`Object` FALSE
 * (cross-realm proto break). We build a REAL guest array/object holding the
 * recursively-marshalled elements, then sever its prototype in the guest
 * (`Object.setPrototypeOf(v, null)`) — same null-proto trick, in reverse. This
 * is a SNAPSHOT: a guest write to a shared object is NOT yet seen by the host
 * (deep live mutation / write-back is T8). Guest-callable host FUNCTIONS are T9;
 * inbound symbols are T10 (loud boundaries).
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
 * guest object is retained by the guest WeakMap for the context's life —
 * acceptable until T9 adds wrapper lifetime management.
 *
 * Disposal (bounded for T6, full lifetime is T9): wrappers RETAIN the guest handle
 * their traps call into — those are NOT disposed here (disposing them breaks the
 * wrapper). Only TRANSIENT handles created inside a trap and immediately consumed
 * are disposed (via `Scope.withScope` / explicit dispose). We NEVER call
 * `ctx.dispose()` on this path; the persistent context lives on. Retained wrapper
 * handles "leak" until T9 — EXPECTED, and does not abort (abort only happens if
 * `ctx.dispose()` runs while handles are alive, which we do not do here).
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import { Scope } from 'quickjs-emscripten-core';

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

/** Marker so the function wrapper can recover its retained guest handle (T7 round-trip). */
const GUEST_HANDLE = Symbol('rifty.vm.guestHandle');

/** A host callable carrying the guest fn handle it forwards to. */
interface GuestFunctionThunk {
  (...args: unknown[]): unknown;
  [GUEST_HANDLE]?: QuickJSHandle;
}

export class Membrane {
  readonly #ctx: QuickJSContext;
  /** guest object id → its single host wrapper (identity cache). */
  readonly #wrappers = new Map<number, unknown>();
  /** Retained guest handles backing live wrappers — NOT disposed in T6 (see file doc). */
  // TODO(Task 9): wrapper handle lifetime via FinalizationRegistry — dispose these
  // when the host wrapper is GC'd, then the context can tear down without aborting.
  readonly #retained: QuickJSHandle[] = [];
  #idOfHandle: QuickJSHandle | undefined;

  // --- Inbound (host→guest) bidirectional identity cache (T7 read path) ---
  /** host object/array/fn → its single seeded guest handle (inbound identity). */
  readonly #inboundGuest = new WeakMap<object, QuickJSHandle>();
  /** guest id (of the seed) → ORIGINAL host object, for the round-trip OUT (#14). */
  readonly #hostOrigins = new Map<number, object>();

  constructor(ctx: QuickJSContext) {
    this.#ctx = ctx;
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
      this.#retained.push(this.#idOfHandle);
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
        return this.#wrapCached(id, () => this.#wrapFunction(handle));
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
          return this.#wrapCached(id, () => this.#wrapArray(handle));
        }
        return this.#wrapCached(id, () => this.#wrapObject(handle));
      }
      default:
        throw new Error(`vm: ${kind} marshalling not implemented (Task 6)`);
    }
  }

  /**
   * Host→guest marshaller (T7 read path). PRIMITIVES become guest values by
   * value; OBJECT/ARRAY become a host-origin-tagged guest SNAPSHOT (identity
   * cached, so the same host object → the same guest value). The returned handle
   * is OWNED by the caller — for cached objects/arrays it is a `dup` of the
   * retained seed; primitives are fresh/constant per the existing convention.
   *
   * Snapshot, not live: a guest write to a shared object is NOT yet seen by the
   * host (deep live mutation / write-back is T8). Host FUNCTION marshalling
   * (guest calling a host fn) is T9 — loud boundary here.
   */
  marshalHostToGuest(value: unknown): QuickJSHandle {
    const ctx = this.#ctx;
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
        // Guest-callable host functions (+ guest callbacks back to host) are T9.
        throw new Error('vm: host→guest function marshalling not implemented (Task 9)');
      default:
        // symbol host→guest is exotic mirroring — T10.
        throw new Error(`vm: host→guest ${typeof value} marshalling not implemented (Task 10)`);
    }
  }

  /**
   * Marshal a host object/array INTO the guest as a host-origin snapshot.
   * Returns a `dup` of the cached seed (caller owns it). Builds-once per host
   * object (inbound identity cache) so re-marshalling yields the same guest
   * value and the round-trip OUT recovers this same host object (#14). Host
   * origin is recorded by the seed's UNFORGEABLE registry id — NO guest-visible
   * marker is written.
   */
  #marshalInboundObject(value: object): QuickJSHandle {
    const cached = this.#inboundGuest.get(value);
    if (cached) return cached.dup();
    const ctx = this.#ctx;
    const isArray = Array.isArray(value);
    // Build the snapshot. The seed handle is RETAINED (it backs the live seeded
    // global); the returned dup is the caller's to dispose.
    const seed = isArray ? ctx.newArray() : ctx.newObject();
    if (isArray) {
      const arr = value as unknown[];
      for (let i = 0; i < arr.length; i++) {
        const elem = this.marshalHostToGuest(arr[i]);
        try {
          ctx.setProp(seed, i, elem);
        } finally {
          if (!this.#isContextConstant(elem)) elem.dispose();
        }
      }
    } else {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        const elem = this.marshalHostToGuest((value as Record<string, unknown>)[key]);
        try {
          ctx.setProp(seed, key, elem);
        } finally {
          if (!this.#isContextConstant(elem)) elem.dispose();
        }
      }
    }
    // Record host-origin keyed by the seed's UNFORGEABLE registry id (NOT a
    // guest-written marker) so the round-trip OUT returns the exact same host
    // reference. `#idOf` assigns a fresh id to this never-before-seen seed.
    this.#hostOrigins.set(this.#idOf(seed), value);
    // Sever the prototype: a host array seen in the guest is `Array.isArray`
    // TRUE (real guest array brand) but `instanceof Array` FALSE (proto is not
    // the guest Array.prototype) — mirrors the OUTBOUND null-proto technique.
    this.#severPrototype(seed);
    this.#inboundGuest.set(value, seed);
    this.#retained.push(seed);
    return seed.dup();
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
   * Seed the LIVE contextObject INTO the guest realm (T7 read path). Each own
   * enumerable key becomes readable in the guest: primitives are defined by
   * value; host objects/arrays are marshalled IN as host-origin-tagged guest
   * snapshots. Defined as own enumerable, writable, configurable globals (a
   * later guest reassignment shadows them — matches Node's contextified global).
   *
   * Re-sync of host-side mutations between runs + write-back of guest-invented
   * globals is T8 — NOT done here (this seeds once, read-only semantics).
   */
  seedContext(context: Record<string, unknown>): void {
    const ctx = this.#ctx;
    for (const key of Object.keys(context)) {
      const valueH = this.marshalHostToGuest(context[key]);
      try {
        // setProp (not defineProp) so the binding is a normal writable global —
        // a guest `key = …` reassigns it rather than throwing.
        ctx.setProp(ctx.global, key, valueH);
      } finally {
        if (!this.#isContextConstant(valueH)) valueH.dispose();
      }
    }
  }

  /** Identity-cache wrapper: same guest object id → same host wrapper. `id` is the precomputed `#idOf`. */
  #wrapCached(id: number, make: () => unknown): unknown {
    const existing = this.#wrappers.get(id);
    if (existing !== undefined) return existing;
    const wrapper = make();
    this.#wrappers.set(id, wrapper);
    return wrapper;
  }

  /** Retain a dup of the guest handle so the wrapper's traps stay valid. */
  #retain(handle: QuickJSHandle): QuickJSHandle {
    const dup = handle.dup();
    this.#retained.push(dup);
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
  #wrapArray(handle: QuickJSHandle): unknown {
    const ctx = this.#ctx;
    this.#retain(handle);
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
    return new Proxy(target, { getPrototypeOf: () => null });
  }

  /**
   * OBJECT wrapper — Proxy over a fresh EXTENSIBLE empty target. Reads route to the
   * guest handle via `ctx.getProp` (incl. `constructor` → guest Object ctor wrapped
   * → `!== host Object`); null proto → `instanceof Object` FALSE; ownKeys +
   * getOwnPropertyDescriptor drive `Object.keys`/JSON. Descriptors are reported
   * `configurable:true` to satisfy Proxy invariants over an empty target (faithful
   * frozen/non-config mirroring is T12).
   */
  #wrapObject(handle: QuickJSHandle): unknown {
    const ctx = this.#ctx;
    const guest = this.#retain(handle);
    const membrane = this;
    const target: Record<PropertyKey, unknown> = {};

    const ownStringKeys = (): string[] => {
      return Scope.withScope((scope) => {
        const names = scope.manage(ctx.getOwnPropertyNames(guest).unwrap());
        return names.map((k) => ctx.getString(k));
      });
    };

    return new Proxy(target, {
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
        // Host→guest write-back is T8.
        throw new Error('vm: host→guest property write not implemented (Task 8)');
      },
      deleteProperty() {
        throw new Error('vm: host→guest property delete not implemented (Task 8)');
      },
    });
  }

  /**
   * FUNCTION wrapper — callable Proxy over a host thunk (target stays a function so
   * the Proxy is callable) with a null proto (so `instanceof Function` FALSE). The
   * thunk marshals host args → guest (primitives + objects/arrays via T7's extended
   * `marshalHostToGuest`; host-fn args are T9), calls the guest fn, and marshals
   * the result back through the membrane.
   */
  #wrapFunction(handle: QuickJSHandle): unknown {
    const ctx = this.#ctx;
    const guest = this.#retain(handle);

    const thunk: GuestFunctionThunk = (...args: unknown[]): unknown => {
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
    thunk[GUEST_HANDLE] = guest;

    return new Proxy(thunk, { getPrototypeOf: () => null });
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
