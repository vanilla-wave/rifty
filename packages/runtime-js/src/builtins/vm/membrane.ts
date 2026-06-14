/**
 * Guest→host membrane for QuickJS completion values (T6).
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
 * Identity cache (guest-side WeakMap id — see `#idOf`): handles are
 * NOT stable Map keys (`ctx.eq` only, QUICKJS_API.md), so the SAME guest object
 * would otherwise yield DIFFERENT host wrappers. We eval a tiny id registry into
 * the guest keyed by a Symbol (no enumerable global pollution) that hands out a
 * stable numeric id per guest object via a guest `WeakMap`; the host keys a
 * `Map<number, hostWrapper>` on it. Chosen over the O(n) `ctx.eq` scan for O(1)
 * lookup and because it works on frozen guest objects (a WeakMap does not mutate
 * them, unlike tagging a hidden property). Trade-off: each wrapped guest object is
 * retained by the guest WeakMap for the context's life — acceptable until T9 adds
 * wrapper lifetime management.
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

/** Symbol-keyed guest id registry — installed once per context, no enumerable pollution. */
const ID_REGISTRY_BOOTSTRAP = `
(() => {
  const KEY = Symbol.for('rifty.vm.idOf');
  if (globalThis[KEY]) return;
  const map = new WeakMap();
  let next = 0;
  globalThis[KEY] = (o) => {
    let id = map.get(o);
    if (id === undefined) { id = ++next; map.set(o, id); }
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

  constructor(ctx: QuickJSContext) {
    this.#ctx = ctx;
  }

  /** Stable numeric id for a guest object handle (lazy-installs the guest registry). */
  #idOf(handle: QuickJSHandle): number {
    if (!this.#idOfHandle) {
      const ctx = this.#ctx;
      ctx.unwrapResult(ctx.evalCode(ID_REGISTRY_BOOTSTRAP)).dispose();
      const sym = ctx.newSymbolFor('rifty.vm.idOf');
      try {
        this.#idOfHandle = ctx.getProp(ctx.global, sym);
      } finally {
        sym.dispose();
      }
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
      case 'function':
        return this.#wrapCached(handle, () => this.#wrapFunction(handle));
      case 'object': {
        // null is typeof 'object' in QuickJS too — distinguish via dump (reliable
        // for null per QUICKJS_API.md).
        if (ctx.dump(handle) === null) return null;
        if (this.#isArray(handle)) {
          return this.#wrapCached(handle, () => this.#wrapArray(handle));
        }
        return this.#wrapCached(handle, () => this.#wrapObject(handle));
      }
      default:
        throw new Error(`vm: ${kind} marshalling not implemented (Task 6)`);
    }
  }

  /** Minimal host→guest marshaller — PRIMITIVES only (full object marshalling is T7). */
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
      case 'object':
        if (value === null) return ctx.null;
        // Host→guest OBJECT/ARRAY marshalling is T7.
        throw new Error('vm: host→guest object marshalling not implemented (Task 7)');
      default:
        // function / symbol host→guest is T7/T9.
        throw new Error(`vm: host→guest ${typeof value} marshalling not implemented (Task 7)`);
    }
  }

  /** Identity-cache wrapper: same guest object id → same host wrapper. Retains a dup. */
  #wrapCached(handle: QuickJSHandle, make: () => unknown): unknown {
    const id = this.#idOf(handle);
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
   * thunk marshals host args → guest (primitives only — T7 adds objects), calls the
   * guest fn, and marshals the result back through the membrane.
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
