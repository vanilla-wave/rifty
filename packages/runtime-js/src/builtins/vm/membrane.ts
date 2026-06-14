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
 * Proxies whose proto break is cross-realm: ARRAY/FUNCTION wrappers use a `null`
 * `getPrototypeOf` trap, while the OBJECT wrapper returns the WRAPPED GUEST
 * prototype (so the chain is guest-wrappers, never host Object.prototype — T12
 * prototype/has coherence) and routes its other traps to the live guest handle.
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
 *                (wrapped → never `=== host Object`). `getPrototypeOf` returns the
 *                WRAPPED GUEST prototype (cross-realm chain of guest-wrappers, never
 *                host Object.prototype → `instanceof Object` FALSE,
 *                `Object.getPrototypeOf(obj) !== host Object.prototype`, terminating
 *                at the guest Object.prototype whose proto is null) while `has` does
 *                a guest-side `key in guest` over that SAME chain (so `'toString' in
 *                obj` is TRUE — T12 prototype/has coherence). `ownKeys`+
 *                `getOwnPropertyDescriptor` drive `Object.keys`/JSON, the descriptor
 *                reconstructed FAITHFULLY (real writable/enumerable/configurable, or
 *                marshalled get/set) via the unreachable reflect closure (T12). Proxy
 *                invariants for a non-configurable / frozen / non-extensible guest
 *                object are satisfied by MIRRORING the relevant state onto the target
 *                (a non-config own prop, a matching proto + `preventExtensions`) on
 *                demand, keeping the empty target otherwise extensible.
 *                `set`/`deleteProperty`/`defineProperty`/`preventExtensions` WRITE
 *                THROUGH to the guest (Node: host mutating a returned guest object
 *                writes to the guest; frozen → loose no-op / strict throw).
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
 * same guest fn → same host wrapper.
 *
 * Exotic mirroring (T10, Date / RegExp / TypedArray, both directions) + carried
 * fidelity. Node cross-realm truth (parity `vm/quickjs-exotic`): an exotic across
 * the membrane is `instanceof <ctor>` FALSE but has the correct brand
 * (`Object.prototype.toString`), working methods, and faithful data both ways.
 *   - OUT: a guest exotic → a REAL host Date/RegExp/TypedArray BACKING (carries the
 *     internal slot → brand + methods) whose [[Prototype]] is a per-kind null-based
 *     FLAT proto carrying that kind's prototype-CHAIN methods (`#exoticProtoFor`;
 *     TypedArrays need the chain — brand/`Symbol.iterator` live on
 *     `%TypedArray%.prototype`). The flat proto is NOT the host ctor's prototype, so
 *     `instanceof` is FALSE while methods/brand resolve off the backing's slot. The
 *     mirror is the wrapper (identity-cached, GC-tracked like object wrappers); the
 *     guest handle backs it for round-trip identity. `.constructor` is omitted
 *     (documented residual — see `#exoticProtoFor`).
 *   - IN: a host exotic → a REAL GUEST Date/RegExp/TypedArray (built via cached
 *     factory fns — no `callConstructor` in the API) then REBRANDED with a
 *     guest-side flat proto (`#rebrandGuestExotic` / `EXOTIC_REBRAND_BOOTSTRAP` — the
 *     MIRROR of the OUT technique, NOT a null proto, which would strip methods).
 *     Identity-cached + host-origin recorded (round-trips OUT to the same host ref).
 *   - Symbols (both directions): WELL-KNOWN + REGISTRY symbols are SHARED across
 *     realms (`Symbol.iterator` OUT `=== host Symbol.iterator`; `Symbol.for(k)` ↔
 *     guest `Symbol.for(k)`); UNIQUE symbols are cross-realm (fresh, same
 *     `.description`, NOT `===`), identity-cached so the same symbol round-trips to
 *     itself. Symbol-keyed OWN props are surfaced by the object wrapper
 *     (`ownKeys`/`get`/`has` route host symbols back to guest symbol keys), so
 *     `Object.getOwnPropertySymbols` + `obj[sym]` + well-known iteration work.
 *   - Function name/length: the OUT fn wrapper copies the GUEST fn's `name`/`length`
 *     onto the host thunk (`#copyFnNameLength`) so a returned guest fn reports them.
 *
 * Error marshalling (T11, both directions) — same cross-realm pattern as exotics.
 * Node truth (parity `vm/quickjs-errors`): a guest error caught in the host is
 * `instanceof Error`/`TypeError` FALSE but `.constructor.name`/`.name`/`.message`/
 * `.stack`/`toString()` faithful and REALLY catchable/rethrowable; a non-Error
 * throw (`throw 42`) is the raw primitive; a host error thrown INTO the guest is a
 * real guest exception with the right `e.constructor.name`/`e.message`.
 *   - OUT (`wrapGuestError` → `#wrapError`): a REAL host Error backing (genuine
 *     throwable + `.stack` slot) whose OWN `name`/`message`/`stack` are the guest's,
 *     with a per-ctor-name FLAT null-based proto (`#errorProtoFor`) carrying the
 *     host `Error.prototype` methods (`toString`) + a SYNTHETIC `constructor` whose
 *     `.name` is the guest ctor name → `instanceof` FALSE, `.constructor.name` +
 *     `toString()` faithful. Identity-cached + GC-tracked like exotics; the engine
 *     inspects the `{error}` handle WITHOUT `unwrapResult` (which would throw the
 *     wrong shape AND dispose the handle), marshals, disposes once, then throws.
 *   - IN (`#guestErrorFromHost`, in the inbound host-fn impl): a thrown host Error
 *     becomes a REAL guest error of the matching ctor (`new globalThis[name](msg)`
 *     via a cached factory, `.name` re-set) THROWN as the guest exception
 *     (`newFunction` transfers a thrown handle); a non-Error host throw marshals
 *     through `marshalHostToGuest` as the raw guest value.
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

/**
 * Guest-side exotic rebrand helper as an UNREACHABLE closure (like the id
 * registry). Given `(value, kindName)` it sets `value`'s [[Prototype]] to a
 * null-based FLAT proto carrying that kind's prototype-chain methods (own
 * descriptors, subclass wins, excluding Object.prototype + `constructor`). Result:
 * a host exotic seeded INTO the guest has `instanceof guestCtor` FALSE (the flat
 * proto is NOT the guest intrinsic prototype) but brand/methods/data faithful (the
 * methods + `Symbol.toStringTag`/`Symbol.iterator` operate on the REAL guest exotic
 * backing's internal slot) — symmetric with the OUT host-side mirror + Node's
 * cross-realm IN behavior. Protos are cached per kind. The closure is retained
 * host-side and NEVER exposed on the guest global (guest code cannot reach it).
 */
const EXOTIC_REBRAND_BOOTSTRAP = `
(() => {
  const cache = new Map();
  const flatProtoFor = (kind) => {
    let fp = cache.get(kind);
    if (fp) return fp;
    fp = Object.create(null);
    const proto = globalThis[kind] && globalThis[kind].prototype;
    for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) {
        if (n === 'constructor') continue;
        if (Object.prototype.hasOwnProperty.call(fp, n)) continue;
        Object.defineProperty(fp, n, Object.getOwnPropertyDescriptor(p, n));
      }
      for (const s of Object.getOwnPropertySymbols(p)) {
        if (Object.prototype.hasOwnProperty.call(fp, s)) continue;
        Object.defineProperty(fp, s, Object.getOwnPropertyDescriptor(p, s));
      }
    }
    cache.set(kind, fp);
    return fp;
  };
  return (value, kind) => { Object.setPrototypeOf(value, flatProtoFor(kind)); return value; };
})();
`;

/**
 * Guest-side rebrand for an INBOUND plain object / array seed (T19 fix), the MIRROR
 * of `EXOTIC_REBRAND_BOOTSTRAP` but walking the FULL prototype chain INCLUDING
 * `Object.prototype`. A host array/object seen in the guest must (Node oracle):
 * carry its prototype METHODS (`arr.map`/`join`, `obj.hasOwnProperty`) yet fail
 * `instanceof Array`/`Object` (its proto is cross-realm, not the guest intrinsic).
 * A null proto (the old sever-to-null seed) satisfied `instanceof` FALSE but STRIPPED
 * the methods — the bug this closure fixes. We give the seed a null-based FLAT proto
 * carrying the kind's whole method chain (Array methods + Object methods for an
 * array; Object methods for an object), so methods resolve, `Array.isArray` stays
 * TRUE (a real `newArray` brand, proto-independent), and `instanceof` is FALSE (the
 * flat proto is NOT `Array.prototype`/`Object.prototype`). Retained host-side, never
 * exposed on the guest global (no-forgery discipline, like the other closures).
 */
const GENERIC_REBRAND_BOOTSTRAP = `
(() => {
  const cache = new Map();
  const flatProtoFor = (kind) => {
    let fp = cache.get(kind);
    if (fp) return fp;
    fp = Object.create(null);
    const proto = kind === 'Array' ? Array.prototype : Object.prototype;
    for (let p = proto; p; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) {
        if (n === 'constructor' || n === '__proto__') continue;
        if (Object.prototype.hasOwnProperty.call(fp, n)) continue;
        Object.defineProperty(fp, n, Object.getOwnPropertyDescriptor(p, n));
      }
      for (const s of Object.getOwnPropertySymbols(p)) {
        if (Object.prototype.hasOwnProperty.call(fp, s)) continue;
        Object.defineProperty(fp, s, Object.getOwnPropertyDescriptor(p, s));
      }
    }
    cache.set(kind, fp);
    return fp;
  };
  return (value, kind) => { Object.setPrototypeOf(value, flatProtoFor(kind)); return value; };
})();
`;

/**
 * Guest-side reflection helper as an UNREACHABLE closure (like the id registry +
 * exotic rebrand) — the no-forgery discipline: retained host-side, NEVER exposed
 * on the guest global, so guest code cannot reach it to influence the host's view.
 *
 * Returns a single function `(op, target, key, arg) => result` for the OUT object
 * wrapper's faithful traps (T12). The host can't `Object.getOwnPropertyDescriptor`
 * a guest object directly (no `ctx.getOwnPropertyDescriptor` — QUICKJS_API.md), so
 * descriptors are reconstructed guest-side and read field-by-field by the host:
 *   - `descriptor` → a fresh object `{present, isAccessor, value?, get?, set?,
 *      writable, enumerable, configurable}` (the host marshals `value`/`get`/`set`
 *      OUT through the membrane); `present:false` if `key` is not an own prop.
 *   - `getProto` → the object's [[Prototype]] (a guest object or null) for the
 *      wrapper's `getPrototypeOf` (wrapped OUT → cross-realm proto chain).
 *   - `has` → `key in target` (walks the guest prototype chain) for `has`.
 *   - `isExtensible` → `Object.isExtensible(target)`.
 *   - `set` → `target[key] = arg` (host→guest write-through); returns whether the
 *      assignment took (false on a frozen/read-only prop, matching Node's loose
 *      `set` trap result), so the host trap returns it.
 *   - `delete` → `delete target[key]`; returns the result.
 *   - `define` → `Object.defineProperty(target, key, arg)` write-through (`arg` is a
 *      guest descriptor the host built — data, or accessor with marshalled guest fns).
 *   - `preventExtensions` → `Object.preventExtensions(target)`.
 * `key` is passed as a guest handle (string OR symbol) so symbol-keyed props work.
 */
const REFLECT_BOOTSTRAP = `
(() => {
  const gOPD = Object.getOwnPropertyDescriptor;
  return (op, target, key, arg) => {
    switch (op) {
      case 'descriptor': {
        const d = gOPD(target, key);
        if (d === undefined) return { present: false };
        const isAccessor = ('get' in d) || ('set' in d);
        return isAccessor
          ? { present: true, isAccessor: true, get: d.get, set: d.set, enumerable: d.enumerable, configurable: d.configurable }
          : { present: true, isAccessor: false, value: d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable };
      }
      case 'getProto': return Object.getPrototypeOf(target);
      case 'has': return (key in target);
      case 'isExtensible': return Object.isExtensible(target);
      // Reflect.set / Reflect.deleteProperty return the spec success boolean WITHOUT
      // throwing — false on a frozen/read-only/non-extensible-new prop, matching
      // Node's loose host trap (silent no-op; host then rejects strict writes).
      case 'set': return Reflect.set(target, key, arg);
      case 'delete': return Reflect.deleteProperty(target, key);
      case 'define': { Object.defineProperty(target, key, arg); return true; }
      case 'preventExtensions': { Object.preventExtensions(target); return true; }
      default: throw new TypeError('vm reflect: unknown op ' + op);
    }
  };
})();
`;

/** Host TypedArray constructors keyed by `Object.prototype.toString` brand tag. */
const TYPED_ARRAY_CTORS = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
} as const;
type TypedArrayKind = keyof typeof TYPED_ARRAY_CTORS;
type TypedArrayInstance = InstanceType<(typeof TYPED_ARRAY_CTORS)[TypedArrayKind]>;
/** brand tag (e.g. "Uint8Array") → kind, for OUT detection via the brand. */
const TYPED_ARRAY_BRANDS = new Map<string, TypedArrayKind>(
  (Object.keys(TYPED_ARRAY_CTORS) as TypedArrayKind[]).map((k) => [k, k]),
);

/** The 13 well-known symbols (ES). OUT detection compares a guest symbol to each. */
const WELL_KNOWN_SYMBOL_NAMES = [
  'asyncIterator',
  'hasInstance',
  'isConcatSpreadable',
  'iterator',
  'match',
  'matchAll',
  'replace',
  'search',
  'species',
  'split',
  'toPrimitive',
  'toStringTag',
  'unscopables',
] as const;

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

  // --- Symbol identity caches (T10) ---
  /**
   * guest UNIQUE-symbol id → its single host mirror symbol. Unique symbols are
   * cross-realm (NOT `===` any host symbol) so we mint a fresh host symbol with
   * the same description; the id cache keeps the SAME host symbol per guest symbol
   * (so a symbol returned twice is `===`). Well-known + registry symbols are SHARED
   * and bypass this cache (`Symbol.for`/`Symbol[name]`). Symbols are NOT GC-tracked
   * wrappers (no backing handle retained), so a plain Map is fine.
   */
  readonly #outSymbols = new Map<number, symbol>();
  /** host UNIQUE symbol → its single guest mirror handle (inbound symbol identity). */
  readonly #inboundSymbols = new WeakMap<symbol, QuickJSHandle>();
  /**
   * guest UNIQUE-symbol id → the ORIGINAL host symbol it was seeded from, so the
   * round-trip OUT (`#wrapSymbol`) recovers THAT host symbol (`=== hostSym`). The
   * symbol analogue of `#hostOrigins` (which is object-only).
   */
  readonly #symbolOrigins = new Map<number, symbol>();
  /**
   * host OUT-mirror symbol → a RETAINED dup of the original guest symbol handle, so
   * a host symbol used as a KEY back into the guest (`obj[sym]` on an OUT object
   * wrapper) resolves to the SAME guest symbol (not a freshly-minted one). The dup
   * is infra-tracked (disposed at teardown).
   */
  readonly #outSymbolGuest = new WeakMap<symbol, QuickJSHandle>();

  // --- Exotic-mirror prototype cache (T10, OUT) ---
  /**
   * Per-exotic-kind shared host prototype carrying that kind's methods but NOT
   * inheriting the host ctor's prototype — so a mirror's `instanceof hostCtor` is
   * FALSE (cross-realm) while `getTime()`/`test()`/typed-array indexing resolve and
   * the brand stays correct (the brand comes from the REAL host exotic backing's
   * internal slot, not the proto). One proto per kind, reused across mirrors.
   */
  readonly #exoticProtos = new Map<string, object>();
  /**
   * Per-error-ctor-name shared host prototype for the OUT error mirror (T11).
   * A null-based flat proto carrying the host `Error.prototype` chain methods
   * (`toString` …) PLUS a synthetic `constructor` whose `.name` is the guest
   * ctor name — so a mirror's `e.constructor.name` is faithful and `e.toString()`
   * works, while `instanceof Error` is FALSE (the proto is NOT host
   * `Error.prototype`). One proto per ctor name (`TypeError`/`Error`/custom),
   * reused across mirrors. Keyed by the guest `constructor.name`.
   */
  readonly #errorProtos = new Map<string, object>();
  /**
   * Cached guest factory functions for IN exotic construction (the API has no
   * `callConstructor` — QUICKJS_API.md). Keyed by factory source; each is an
   * infra-tracked guest fn handle (disposed at teardown), so re-marshalling is cheap.
   */
  readonly #exoticFactories = new Map<string, QuickJSHandle>();
  /** Lazily-installed guest exotic rebrand closure (`EXOTIC_REBRAND_BOOTSTRAP`), infra-tracked. */
  #rebrandHandle: QuickJSHandle | undefined;
  /**
   * Lazily-installed guest INBOUND object/array rebrand closure
   * (`GENERIC_REBRAND_BOOTSTRAP`, T19), infra-tracked. Gives a seeded host
   * array/object the kind's full method chain on a cross-realm flat proto.
   */
  #genericRebrandHandle: QuickJSHandle | undefined;
  /** Lazily-installed guest reflection closure (`REFLECT_BOOTSTRAP`, T12), infra-tracked. */
  #reflectHandle: QuickJSHandle | undefined;
  /**
   * Sandbox own keys captured at `reseedContext` time, consumed by the next
   * `sweepContext` for DELETE-reflection: a seeded key the guest deleted (a
   * configurable global removed via `delete`) is no longer an own-enumerable key
   * of the guest global after the run, so it is removed from the sandbox too —
   * matching Node's live contextified object (`delete gone` ⇒ `'gone' in sb` false).
   */
  #preRunSandboxKeys: readonly string[] = [];

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
        return this.#wrapSymbol(handle);
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
        // Exotic OUT (T10): a guest Date/RegExp/TypedArray must mirror Node's
        // cross-realm behavior — `instanceof hostCtor` FALSE, but correct brand
        // (`Object.prototype.toString`), working methods, and faithful data. We
        // detect via the object's brand and build a REAL host exotic backing with a
        // severed-but-method-bearing prototype (`#exoticProtoFor`).
        const brand = this.#brandOf(handle);
        if (brand === 'Date') return this.#wrapCached(id, () => this.#wrapDate(handle, id));
        if (brand === 'RegExp') return this.#wrapCached(id, () => this.#wrapRegExp(handle, id));
        // Error OUT (T11): a guest Error must mirror Node's cross-realm shape —
        // `instanceof Error` FALSE, but `.constructor.name`/`.name`/`.message`/
        // `.stack`/`toString()` faithful and the value REALLY catchable/rethrowable.
        // The brand of every Error subclass is `Error` (`Object.prototype.toString`).
        if (brand === 'Error') return this.#wrapCached(id, () => this.#wrapError(handle, id));
        const taKind = TYPED_ARRAY_BRANDS.get(brand);
        if (taKind !== undefined) {
          return this.#wrapCached(id, () => this.#wrapTypedArray(handle, id, taKind));
        }
        if (this.#isArray(handle)) {
          return this.#wrapCached(id, () => this.#wrapArray(handle, id));
        }
        return this.#wrapCached(id, () => this.#wrapObject(handle, id));
      }
      default:
        // Unreachable: `kind` is `ctx.typeof`, every JS typeof is handled above.
        // Exhaustiveness guard (not an unbuilt feature).
        throw new Error(`vm: unexpected guest value kind '${kind}'`);
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
        // Exotic IN (T10): a host Date/RegExp/TypedArray must mirror as a REAL
        // guest exotic (correct brand/methods/data) with a SEVERED prototype so
        // `instanceof guestCtor` is FALSE — symmetric with the OUT mirror + the
        // existing inbound null-proto technique. Detected via the host brand.
        const exotic = this.#marshalInboundExotic(value);
        if (exotic !== undefined) return exotic;
        return this.#marshalInboundObject(value);
      }
      case 'function':
        // A genuine HOST function entering the guest (guest-callable host fn, T9).
        return this.#marshalInboundFunction(value as (...args: unknown[]) => unknown);
      case 'symbol':
        return this.#marshalInboundSymbol(value as symbol);
      default:
        // Exhaustiveness guard: the 7 JS `typeof`s above are total. Unreachable.
        throw new Error(`vm: host→guest ${typeof value} marshalling unreachable`);
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
    // Rebrand to a cross-realm FLAT proto carrying the kind's full method chain
    // (T19): a host array seen in the guest is `Array.isArray` TRUE (real guest
    // array brand) and has working methods (`arr.map`/`join`, `obj.hasOwnProperty`)
    // yet `instanceof Array`/`Object` FALSE (the flat proto is NOT the guest
    // intrinsic prototype) — the Node oracle. A null proto satisfied the
    // `instanceof`-FALSE half but STRIPPED the methods (the bug this replaces).
    this.#rebrandGuestGeneric(seed, isArray ? 'Array' : 'Object');
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
      let result: unknown;
      try {
        result = fn(...args);
      } catch (err) {
        // Host fn threw (T11): raise it INTO the guest as a real guest exception
        // so guest `try/catch` sees the right `e.constructor.name`/`e.message`
        // (verified oracle, `vm/quickjs-errors`). `newFunction` TRANSFERS a thrown
        // handle (quickjs becomes its owner — do NOT dispose it here), so guest
        // code catches it and (if rethrown) it round-trips back OUT via the engine.
        throw this.#guestErrorFromHost(err);
      }
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

  /**
   * Rebrand an INBOUND object/array seed (T19): set its [[Prototype]] to a
   * cross-realm flat proto carrying the kind's full method chain (`Array`/`Object`)
   * via the unreachable `GENERIC_REBRAND_BOOTSTRAP` closure, so methods work
   * (`arr.map`, `obj.hasOwnProperty`) while `instanceof Array`/`Object` stays FALSE
   * and `Array.isArray` stays TRUE. Replaces the old null-proto `#severPrototype`,
   * which stripped the methods.
   */
  #rebrandGuestGeneric(handle: QuickJSHandle, kind: 'Array' | 'Object'): void {
    const ctx = this.#ctx;
    if (!this.#genericRebrandHandle) {
      this.#genericRebrandHandle = ctx.unwrapResult(ctx.evalCode(GENERIC_REBRAND_BOOTSTRAP));
      this.#lifetime.trackInfra(this.#genericRebrandHandle);
    }
    Scope.withScope((scope) => {
      const kindH = scope.manage(ctx.newString(kind));
      scope.manage(
        ctx.unwrapResult(
          ctx.callFunction(
            this.#genericRebrandHandle as QuickJSHandle,
            ctx.undefined,
            handle,
            kindH,
          ),
        ),
      );
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
    // Snapshot the sandbox keys present BEFORE the run so the post-run sweep can
    // reflect a guest `delete` of a seeded key back onto the sandbox.
    this.#preRunSandboxKeys = Object.keys(context);
    for (const key of this.#preRunSandboxKeys) {
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
   *
   * Declaration-only `var`/`function` exception (T13): a top-level `var z;` makes
   * `z` an enumerable own prop of the vm GLOBAL (so `this.z`/`Object.keys(this)`
   * see it — matching Node), but V8's contextify does NOT copy it to the
   * contextified sandbox object: it only mirrors a global back to the sandbox when
   * an assignment actually fired (the global property SETTER), and a pure `var z;`
   * declaration never sets. We have no global setter interceptor in the QuickJS
   * realm, so we approximate with the post-run signature of a declaration-only
   * binding — value `undefined` AND a NON-CONFIGURABLE binding (`#isDeclOnlyVar`):
   * skip those, matching Node's `var z;`/`function … then deleted` while still
   * propagating `this.x = undefined` / `bare = undefined` (configurable) and every
   * assigned value. Residual divergence: an explicit `var x = undefined` initializer
   * is post-run indistinguishable from `var x;` (same undefined value + non-config),
   * so it is ALSO skipped — Node would copy it (documented T13 residual).
   */
  sweepContext(context: Record<string, unknown>): void {
    const ctx = this.#ctx;
    const guestKeys = this.#ownEnumerableKeys(ctx.global);
    for (const key of guestKeys) {
      const guestVal = ctx.getProp(ctx.global, key);
      try {
        const origin = this.#originOf(guestVal);
        if (origin !== undefined) {
          this.#sweepInto(guestVal, origin);
          context[key] = origin;
        } else if (!this.#isDeclOnlyVar(ctx.global, key, guestVal)) {
          context[key] = this.wrapGuestToHost(guestVal);
        }
      } finally {
        guestVal.dispose();
      }
    }
    // DELETE-reflection: a seeded key the guest removed (`delete`) is gone from the
    // guest global's enumerable keys → drop it from the sandbox too (Node's live
    // contextified object reflects the delete). Only pre-run seeded keys are
    // considered, so a NEW global is never spuriously deleted.
    const present = new Set(guestKeys);
    for (const key of this.#preRunSandboxKeys) {
      if (!present.has(key) && key in context) delete context[key];
    }
    this.#preRunSandboxKeys = [];
  }

  /**
   * True if a guest global key is a declaration-only `var`/`function` binding NOT
   * meant to surface on the contextified sandbox (T13): its current value is
   * `undefined` AND it is a NON-CONFIGURABLE own prop of the global. Seeded sandbox
   * keys are configurable (`setProp`), so this never skips them; an actual
   * assignment to a non-undefined value also passes through. See `sweepContext`.
   */
  #isDeclOnlyVar(global: QuickJSHandle, key: string, value: QuickJSHandle): boolean {
    if (this.#ctx.typeof(value) !== 'undefined') return false;
    return this.#isNonConfigurableGlobalKey(global, key);
  }

  /** Read just the `configurable` flag of a string key on the guest global (false ⇒ non-config). */
  #isNonConfigurableGlobalKey(global: QuickJSHandle, key: string): boolean {
    const ctx = this.#ctx;
    return Scope.withScope((scope) => {
      const keyH = scope.manage(ctx.newString(key));
      const d = scope.manage(this.#callReflect('descriptor', global, keyH));
      if (this.#readBool(d, 'present') !== true) return false;
      return this.#readBool(d, 'configurable') !== true;
    });
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
   * Also records the dup for the OUT-wrapper round-trip (`#outWrapperGuest`).
   *
   * Leak-safe: the dup is TRACKED before any throwable wrapper-construction work
   * (e.g. `#wrapArray`'s eager element marshalling, which can throw the loud T10
   * boundary). If construction throws AFTER this returns, the handle is already
   * counted in `#live`, so a later `markPending`/`dispose` either defers (no
   * abort) or disposes it via GC/`releaseWrapper` — never a silently-leaked live
   * handle that trips the `ctx.dispose()` leaked-handle abort.
   */
  #retainForWrapper(wrapper: object, handle: QuickJSHandle, id: number): QuickJSHandle {
    const dup = handle.dup();
    this.#outWrapperGuest.set(wrapper, dup);
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
    const length = ctx.getLength(handle) ?? 0;
    // Build the empty target + Proxy and TRACK the dup'd guest handle (+ record
    // the OUT round-trip) BEFORE the throwable element marshalling. Element
    // marshalling can hit the loud T10 boundary (e.g. a guest `Symbol` element);
    // tracking first means a throw leaves the dup counted in `#live` (disposed by
    // GC/`releaseWrapper`) instead of an untracked live handle that would later
    // abort `ctx.dispose()`. See `#retainForWrapper`.
    const target: unknown[] = [];
    const wrapper = new Proxy(target, { getPrototypeOf: () => null });
    this.#retainForWrapper(wrapper, handle, id);
    try {
      for (let i = 0; i < length; i++) {
        const elem = ctx.getProp(handle, i);
        try {
          target.push(this.wrapGuestToHost(elem));
        } finally {
          elem.dispose();
        }
      }
    } catch (err) {
      // Element marshalling threw (e.g. a guest `Symbol` element, T10). The
      // wrapper is never returned/cached, so release its tracked dup NOW
      // (disposing the handle + decrementing `#live`) rather than waiting for GC
      // of an unreachable Proxy — leaves no outstanding handle for this failed
      // wrapper, so a later `markPending`/`dispose` is clean.
      this.#lifetime.releaseWrapper(wrapper);
      throw err;
    }
    return wrapper;
  }

  /**
   * OBJECT wrapper — Proxy over a fresh EXTENSIBLE empty target. Reads route to the
   * guest handle via `ctx.getProp` (incl. `constructor` → guest Object ctor wrapped
   * → `!== host Object`); `getPrototypeOf` returns the WRAPPED GUEST prototype so
   * the proto CHAIN is guest-wrappers (`instanceof Object` FALSE, `getPrototypeOf
   * !== host Object.prototype`, terminating at the guest Object.prototype whose
   * proto is null) while `'toString' in obj` is TRUE — `has` does a guest-side
   * `key in guest` walking that same chain (T6 prototype/has coherence). ownKeys +
   * getOwnPropertyDescriptor drive `Object.keys`/JSON.
   *
   * Descriptor fidelity (T12): `getOwnPropertyDescriptor` reconstructs the REAL
   * guest descriptor (writable/enumerable/configurable, or get/set marshalled OUT)
   * via the unreachable reflect closure. Proxy invariants: a non-configurable guest
   * prop is MIRRORED as a matching non-configurable own prop on the target (else the
   * trap report is rejected); a frozen/non-extensible guest object makes the target
   * non-extensible too (after aligning its proto), so `Object.isFrozen`/`isSealed`/
   * `isExtensible` are faithful. `set`/`deleteProperty`/`defineProperty`/
   * `preventExtensions` WRITE THROUGH to the guest (Node: host mutating a returned
   * guest object writes to the guest; rejected on frozen → loose no-op / strict throw).
   *
   * Symbol-keyed props (T10): `ownKeys` also lists the guest's own SYMBOL keys
   * (marshalled OUT to host symbols → `Object.getOwnPropertySymbols` works), and
   * `get`/`has`/`getOwnPropertyDescriptor`/`set`/`deleteProperty` route a host
   * symbol key BACK to a guest symbol handle (`#guestSymbolHandleFor`) so `obj[sym]`
   * reads/writes and well-known iteration (`[...obj]` via `Symbol.iterator`) resolve.
   */
  #wrapObject(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const target: Record<PropertyKey, unknown> = {};
    // `guest` is the tracked dup the traps read; assigned after the Proxy exists
    // (traps only fire post-construction, so the late binding is safe). Must be
    // `let` — declared before the Proxy, captured by the traps, assigned below.
    // biome-ignore lint/style/useConst: late-bound across the trap closure — see above.
    let guest!: QuickJSHandle;

    const ownStringKeys = (): string[] => {
      return Scope.withScope((scope) => {
        const names = scope.manage(ctx.getOwnPropertyNames(guest).unwrap());
        return names.map((k) => ctx.getString(k));
      });
    };
    // Own SYMBOL keys marshalled OUT to host symbols (for `ownKeys` /
    // `getOwnPropertySymbols`). Each guest symbol-key handle is wrapped via the
    // identity-cached symbol path so the same guest symbol → the same host symbol.
    const ownSymbolKeys = (): symbol[] => {
      return Scope.withScope((scope) => {
        const names = scope.manage(ctx.getOwnPropertyNames(guest, { symbols: true }).unwrap());
        return names.map((k) => this.#wrapSymbol(k));
      });
    };
    // Read a guest prop by a host KEY (string or symbol) → host value. Symbol keys
    // convert back to a transient guest symbol handle.
    const readProp = (key: string | symbol): unknown => {
      const keyH = typeof key === 'symbol' ? this.#guestSymbolHandleFor(key) : undefined;
      try {
        const valueH = ctx.getProp(guest, keyH ?? (key as string));
        try {
          return this.wrapGuestToHost(valueH);
        } finally {
          valueH.dispose();
        }
      } finally {
        keyH?.dispose();
      }
    };
    const hasSymbolKey = (key: symbol): boolean => ownSymbolKeys().includes(key);
    const hasOwn = (key: string | symbol): boolean =>
      typeof key === 'symbol' ? hasSymbolKey(key) : ownStringKeys().includes(key);

    // Bring the target into agreement with the guest BEFORE a structural trap
    // result (descriptor/isExtensible/preventExtensions) so the Proxy invariants
    // hold: non-configurable guest props become matching non-configurable own props
    // on the target, and a non-extensible guest object makes the target
    // non-extensible (with a matching wrapped proto). Lazy + idempotent.
    const syncTarget = (key?: string | symbol): void => {
      this.#syncTargetWith(target, guest, () => this.#wrappedGuestProto(guest), key);
    };

    const wrapper = new Proxy(target, {
      getPrototypeOf: () => this.#wrappedGuestProto(guest),
      get(_t, key) {
        if (typeof key === 'symbol' && !hasSymbolKey(key)) return undefined;
        return readProp(key);
      },
      has: (_t, key) => this.#reflectHas(guest, key),
      ownKeys() {
        return [...ownStringKeys(), ...ownSymbolKeys()];
      },
      getOwnPropertyDescriptor: (_t, key) => {
        if (!hasOwn(key)) return undefined;
        syncTarget(key);
        return this.#reflectDescriptor(guest, key);
      },
      isExtensible: (_t) => {
        syncTarget();
        return Reflect.isExtensible(_t);
      },
      preventExtensions: (_t) => {
        // Write through to the guest, then realign the target to the now-frozen
        // guest so `Reflect.isExtensible(target)` is false (invariant: the trap
        // must report the target's real extensibility).
        this.#reflectPreventExtensions(guest);
        syncTarget();
        return !Reflect.isExtensible(_t);
      },
      set: (_t, key, value) => this.#reflectSet(guest, key, value),
      deleteProperty: (_t, key) => this.#reflectDelete(guest, key),
      defineProperty: (_t, key, desc) => {
        const ok = this.#reflectDefine(guest, key, desc);
        // A non-configurable define must be mirrored onto the target so a later
        // `getOwnPropertyDescriptor`/`isExtensible` report stays invariant-consistent.
        if (ok && desc.configurable === false) syncTarget(key);
        return ok;
      },
    });
    // dup+track the guest handle (and record the OUT round-trip) via the shared
    // leak-safe path. Object traps are lazy (no construct-time marshal), so no
    // throwable work follows — but this keeps all three wrappers on one path.
    guest = this.#retainForWrapper(wrapper, handle, id);
    return wrapper;
  }

  // ===========================================================================
  // Object-wrapper reflection (T12): faithful descriptor / proto / has / mutation.
  // ===========================================================================

  /**
   * Call the unreachable guest reflect closure (`REFLECT_BOOTSTRAP`) and return the
   * RESULT handle (caller owns + disposes). `op` selects the operation; `key`/`arg`
   * are optional guest handles. The closure is lazily installed + infra-tracked (it
   * is NEVER exposed on the guest global, preserving the no-forgery discipline).
   */
  #callReflect(
    op: string,
    target: QuickJSHandle,
    key?: QuickJSHandle,
    arg?: QuickJSHandle,
  ): QuickJSHandle {
    const ctx = this.#ctx;
    if (!this.#reflectHandle) {
      this.#reflectHandle = ctx.unwrapResult(ctx.evalCode(REFLECT_BOOTSTRAP));
      this.#lifetime.trackInfra(this.#reflectHandle);
    }
    return Scope.withScope((scope) => {
      const opH = scope.manage(ctx.newString(op));
      const args: QuickJSHandle[] = [opH, target, key ?? ctx.undefined, arg ?? ctx.undefined];
      // The returned handle must OUTLIVE the scope — do NOT manage it here.
      return ctx.unwrapResult(
        ctx.callFunction(this.#reflectHandle as QuickJSHandle, ctx.undefined, ...args),
      );
    });
  }

  /** Transient guest key handle for a host property key (string OR symbol). Caller disposes. */
  #guestKeyHandle(key: string | symbol): QuickJSHandle {
    return typeof key === 'symbol' ? this.#guestSymbolHandleFor(key) : this.#ctx.newString(key);
  }

  /** Wrapped-OUT host view of a guest object's [[Prototype]] (null if guest proto is null). */
  #wrappedGuestProto(guest: QuickJSHandle): object | null {
    const protoH = this.#callReflect('getProto', guest);
    try {
      const wrapped = this.wrapGuestToHost(protoH);
      // Guest proto is an object or null; `wrapGuestToHost` returns the wrapper
      // (identity-cached → stable `getPrototypeOf`) or null. Never a primitive.
      return wrapped as object | null;
    } finally {
      protoH.dispose();
    }
  }

  /** Guest-side `key in guest` (walks the guest prototype chain) for the `has` trap. */
  #reflectHas(guest: QuickJSHandle, key: string | symbol): boolean {
    const keyH = this.#guestKeyHandle(key);
    try {
      const r = this.#callReflect('has', guest, keyH);
      try {
        return this.#ctx.dump(r) === true;
      } finally {
        r.dispose();
      }
    } finally {
      keyH.dispose();
    }
  }

  /**
   * Reconstruct a guest own-property descriptor as a host descriptor (T12). Data
   * props carry the real writable/enumerable/configurable + marshalled value;
   * accessor props carry the marshalled get/set fns. Returns undefined if the key
   * is not an own prop. The caller has already mirrored a non-configurable prop onto
   * the target (`syncTarget`) so the Proxy invariant holds.
   */
  #reflectDescriptor(guest: QuickJSHandle, key: string | symbol): PropertyDescriptor | undefined {
    const keyH = this.#guestKeyHandle(key);
    try {
      const d = this.#callReflect('descriptor', guest, keyH);
      try {
        if (this.#readBool(d, 'present') !== true) return undefined;
        const enumerable = this.#readBool(d, 'enumerable') === true;
        const configurable = this.#readBool(d, 'configurable') === true;
        if (this.#readBool(d, 'isAccessor') === true) {
          return {
            get: this.#readField(d, 'get') as PropertyDescriptor['get'],
            set: this.#readField(d, 'set') as PropertyDescriptor['set'],
            enumerable,
            configurable,
          };
        }
        return {
          value: this.#readField(d, 'value'),
          writable: this.#readBool(d, 'writable') === true,
          enumerable,
          configurable,
        };
      } finally {
        d.dispose();
      }
    } finally {
      keyH.dispose();
    }
  }

  /** Host→guest write-through `set` (`Reflect.set` semantics → success boolean). */
  #reflectSet(guest: QuickJSHandle, key: string | symbol, value: unknown): boolean {
    const ctx = this.#ctx;
    const keyH = this.#guestKeyHandle(key);
    const argH = this.marshalHostToGuest(value);
    try {
      const r = this.#callReflect('set', guest, keyH, argH);
      try {
        return ctx.dump(r) === true;
      } finally {
        r.dispose();
      }
    } finally {
      keyH.dispose();
      if (!this.#isContextConstant(argH)) argH.dispose();
    }
  }

  /** Host→guest write-through `deleteProperty` (`Reflect.deleteProperty` → boolean). */
  #reflectDelete(guest: QuickJSHandle, key: string | symbol): boolean {
    const ctx = this.#ctx;
    const keyH = this.#guestKeyHandle(key);
    try {
      const r = this.#callReflect('delete', guest, keyH);
      try {
        return ctx.dump(r) === true;
      } finally {
        r.dispose();
      }
    } finally {
      keyH.dispose();
    }
  }

  /** Host→guest write-through `preventExtensions`. */
  #reflectPreventExtensions(guest: QuickJSHandle): void {
    this.#callReflect('preventExtensions', guest).dispose();
  }

  /**
   * Host→guest write-through `defineProperty` (T12). Builds a guest descriptor object
   * (value or get/set marshalled IN), then `Object.defineProperty(guest, key, desc)`.
   */
  #reflectDefine(guest: QuickJSHandle, key: string | symbol, desc: PropertyDescriptor): boolean {
    const ctx = this.#ctx;
    const keyH = this.#guestKeyHandle(key);
    const descH = this.#guestDescriptor(desc);
    try {
      const r = this.#callReflect('define', guest, keyH, descH);
      try {
        return ctx.dump(r) === true;
      } finally {
        r.dispose();
      }
    } finally {
      keyH.dispose();
      descH.dispose();
    }
  }

  /** Build a guest descriptor object from a host one (value/get/set marshalled IN). Caller disposes. */
  #guestDescriptor(desc: PropertyDescriptor): QuickJSHandle {
    const ctx = this.#ctx;
    const g = ctx.newObject();
    const setField = (k: string, v: unknown): void => {
      const vh = this.marshalHostToGuest(v);
      try {
        ctx.setProp(g, k, vh);
      } finally {
        if (!this.#isContextConstant(vh)) vh.dispose();
      }
    };
    try {
      if ('value' in desc) setField('value', desc.value);
      if ('writable' in desc) setField('writable', desc.writable);
      if ('get' in desc) setField('get', desc.get);
      if ('set' in desc) setField('set', desc.set);
      if ('enumerable' in desc) setField('enumerable', desc.enumerable);
      if ('configurable' in desc) setField('configurable', desc.configurable);
    } catch (err) {
      g.dispose();
      throw err;
    }
    return g;
  }

  /**
   * Mirror the guest object's invariant-relevant state onto the wrapper's target so
   * the Proxy invariants hold (T12): any NON-CONFIGURABLE own prop becomes a
   * matching own prop on the target, and if the guest is NON-EXTENSIBLE the target's
   * proto is aligned to the wrapped guest proto and the target is sealed
   * non-extensible. Lazy + idempotent (skips props already on the target). `key`
   * scopes the prop sync to one key (descriptor/define path); omitted = all own
   * string keys (isExtensible/preventExtensions path).
   */
  #syncTargetWith(
    target: Record<PropertyKey, unknown>,
    guest: QuickJSHandle,
    protoFor: () => object | null,
    key?: string | symbol,
  ): void {
    const ctx = this.#ctx;
    const keys: (string | symbol)[] =
      key !== undefined
        ? [key]
        : Scope.withScope((scope) => {
            const names = scope.manage(ctx.getOwnPropertyNames(guest).unwrap());
            return names.map((k) => ctx.getString(k));
          });
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(target, k)) continue;
      const desc = this.#reflectDescriptor(guest, k);
      if (desc === undefined || desc.configurable !== false) continue;
      // A non-configurable guest prop MUST exist on the target with a compatible
      // descriptor (Proxy invariant). Mirror it exactly (the marshalled value is
      // identity-cached, so the `get` trap returns the SAME reference — the
      // non-config/non-writable `get` invariant holds).
      Object.defineProperty(target, k, desc);
    }
    // Non-extensible guest → make the target non-extensible too (after aligning its
    // proto, so the `getPrototypeOf` invariant on a non-extensible target holds).
    if (Reflect.isExtensible(target) && !this.#reflectIsExtensible(guest)) {
      Object.setPrototypeOf(target, protoFor());
      Object.preventExtensions(target);
    }
  }

  /** Guest-side `Object.isExtensible(guest)`. */
  #reflectIsExtensible(guest: QuickJSHandle): boolean {
    const r = this.#callReflect('isExtensible', guest);
    try {
      return this.#ctx.dump(r) === true;
    } finally {
      r.dispose();
    }
  }

  /** Read a boolean field off a guest result object. */
  #readBool(obj: QuickJSHandle, key: string): boolean {
    const ctx = this.#ctx;
    return Scope.withScope((scope) => {
      const h = scope.manage(ctx.getProp(obj, key));
      return ctx.dump(h) === true;
    });
  }

  /** Marshal a field off a guest result object OUT to a host value. */
  #readField(obj: QuickJSHandle, key: string): unknown {
    const ctx = this.#ctx;
    const h = ctx.getProp(obj, key);
    try {
      return this.wrapGuestToHost(h);
    } finally {
      h.dispose();
    }
  }

  /**
   * FUNCTION wrapper — callable Proxy over a host thunk (target stays a function so
   * the Proxy is callable) with a null proto (so `instanceof Function` FALSE). The
   * thunk marshals host args → guest (primitives + objects/arrays + host fns via
   * `marshalHostToGuest`), marshals the `this` binding (so a returned guest METHOD
   * called as `obj.method()` / `fn.call(obj, …)` runs with the right guest receiver
   * — the wrapper `this` round-trips back to its guest object via `#outWrapperGuest`,
   * T12 prototype/has coherence), calls the guest fn, and marshals the result back.
   * The guest handle is DUP+RETAINED so the host can call the wrapper AFTER the run —
   * e.g. a guest callback passed to a host fn and stored (`keep(cb); stored()`).
   */
  #wrapFunction(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    // `guest` is the tracked dup the thunk calls; assigned after the Proxy exists
    // (the thunk only runs post-construction, so the late binding is safe). Must
    // be `let` — declared before the thunk, captured by it, assigned below.
    // biome-ignore lint/style/useConst: late-bound across the thunk closure — see above.
    let guest!: QuickJSHandle;

    // Regular function (NOT arrow) so it has its OWN `this` — bound by the Proxy's
    // default `apply` to the receiver (`obj.method()` → the wrapper; `fn.call(o)` →
    // `o`). `this` is marshalled IN as the guest call receiver.
    const self = this;
    function thunk(this: unknown, ...args: unknown[]): unknown {
      return Scope.withScope((scope) => {
        const manageArg = (h: QuickJSHandle): QuickJSHandle =>
          // Context constants (undefined/null/true/false) are context-owned — never
          // manage them for disposal; only manage freshly-created arg handles.
          self.#isContextConstant(h) ? h : scope.manage(h);
        // Marshal `this`: undefined/non-object receivers call with guest undefined;
        // a wrapper receiver round-trips to its own guest object (`#outWrapperGuest`).
        const thisH =
          this === undefined || this === null
            ? ctx.undefined
            : manageArg(self.marshalHostToGuest(this));
        const argHandles = args.map((a) => manageArg(self.marshalHostToGuest(a)));
        const ret = scope.manage(ctx.unwrapResult(ctx.callFunction(guest, thisH, ...argHandles)));
        return self.wrapGuestToHost(ret);
      });
    }

    // Fidelity (T10): a returned guest fn must report the GUEST fn's `name` and
    // `length`, not the host thunk's (`'thunk'`/0). Read them off the guest handle
    // and redefine the thunk's own `name`/`length` (both configurable on a fn) so
    // the Proxy surfaces them. Done BEFORE the Proxy so the wrapper is final.
    this.#copyFnNameLength(handle, thunk);
    const wrapper = new Proxy(thunk, { getPrototypeOf: () => null });
    // dup+track the guest handle (and record the OUT round-trip) via the shared
    // leak-safe path. While the host HOLDS the wrapper (e.g. `stored = cb`), the
    // dup stays alive, so calling it AFTER the run does `callFunction` on a
    // still-valid handle (T9).
    guest = this.#retainForWrapper(wrapper, handle, id);
    return wrapper;
  }

  // ===========================================================================
  // Exotic mirroring (T10): Date / RegExp / TypedArray, both directions.
  // ===========================================================================

  /**
   * `Object.prototype.toString.call(handle)` brand tag of a guest object, sliced
   * to the bare tag (`"[object Date]"` → `"Date"`). The reliable cross-realm brand
   * probe (QUICKJS_API.md: `dump`/`typeof` are not). Used to detect guest exotics.
   */
  #brandOf(handle: QuickJSHandle): string {
    const ctx = this.#ctx;
    return Scope.withScope((scope) => {
      const objectCtor = scope.manage(ctx.getProp(ctx.global, 'Object'));
      const proto = scope.manage(ctx.getProp(objectCtor, 'prototype'));
      const toStr = scope.manage(ctx.getProp(proto, 'toString'));
      const r = scope.manage(ctx.unwrapResult(ctx.callFunction(toStr, handle)));
      const tag = ctx.getString(r); // "[object Date]"
      return tag.slice(8, -1);
    });
  }

  /**
   * Shared host prototype for an exotic KIND — carries the host ctor.prototype's
   * methods (copied as own descriptors) but a `null` [[Prototype]] so it is NOT in
   * the host ctor's chain → a mirror's `instanceof hostCtor` is FALSE (cross-realm,
   * like Node). Methods operate on the REAL host exotic backing (which carries the
   * internal slot + brand), so `getTime()`/`test()`/typed-array indexing work.
   *
   * `constructor` is intentionally OMITTED (the flat proto's null base → a mirror's
   * `.constructor` is `undefined`). Node returns the GUEST ctor here (name e.g.
   * "Date", `!== host Date`); faithfully mirroring that would require RETAINING a
   * guest-fn wrapper on the shared (membrane-lived) proto, which would pin a
   * wrapper-backed handle for the context's life and defeat the GC-driven teardown
   * (the live-wrapper refcount would never reach 0). Documented residual — the
   * tested cross-realm behaviors (instanceof/brand/methods/data/JSON) are faithful.
   */
  #exoticProtoFor(kind: string, hostProto: object): object {
    const cached = this.#exoticProtos.get(kind);
    if (cached) return cached;
    const proto = Object.create(null) as object;
    // Flatten the host prototype CHAIN (up to but EXCLUDING Object.prototype) onto
    // one null-based proto. TypedArrays need this: their methods + the
    // `Symbol.toStringTag`/`Symbol.iterator` (driving brand + `Array.from`) live on
    // `%TypedArray%.prototype` (the PARENT of `Uint8Array.prototype`), not on the
    // per-kind prototype. Date/RegExp methods sit directly on their prototype whose
    // parent IS Object.prototype, so the walk copies exactly their own props.
    // A subclass's descriptor wins over a superclass's (define only first-seen).
    for (
      let p: object | null = hostProto;
      p !== null && p !== Object.prototype;
      p = Object.getPrototypeOf(p)
    ) {
      for (const name of Object.getOwnPropertyNames(p)) {
        if (name === 'constructor') continue; // OMITTED — documented residual (see this method's doc)
        if (Object.prototype.hasOwnProperty.call(proto, name)) continue;
        Object.defineProperty(
          proto,
          name,
          Object.getOwnPropertyDescriptor(p, name) as PropertyDescriptor,
        );
      }
      for (const sym of Object.getOwnPropertySymbols(p)) {
        if (Object.prototype.hasOwnProperty.call(proto, sym)) continue;
        Object.defineProperty(
          proto,
          sym,
          Object.getOwnPropertyDescriptor(p, sym) as PropertyDescriptor,
        );
      }
    }
    this.#exoticProtos.set(kind, proto);
    return proto;
  }

  /**
   * OUT Date mirror — a REAL host Date (same epoch, so it carries the [[DateValue]]
   * slot → brand `[object Date]` + working methods) with the shared severed proto
   * (`instanceof Date` FALSE). The guest handle is retained for identity/round-trip.
   */
  #wrapDate(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const time = Scope.withScope((scope) => {
      const proto = scope.manage(ctx.getProp(ctx.global, 'Date'));
      const protoObj = scope.manage(ctx.getProp(proto, 'prototype'));
      const getTime = scope.manage(ctx.getProp(protoObj, 'getTime'));
      const r = scope.manage(ctx.unwrapResult(ctx.callFunction(getTime, handle)));
      return ctx.getNumber(r);
    });
    const mirror = new Date(time);
    Object.setPrototypeOf(mirror, this.#exoticProtoFor('Date', Date.prototype));
    this.#retainForWrapper(mirror, handle, id);
    return mirror;
  }

  /**
   * OUT RegExp mirror — a REAL host RegExp built from the guest's `source`/`flags`
   * (carries the [[RegExpMatcher]] slot → brand `[object RegExp]` + working
   * `test`/`exec`) with the shared severed proto (`instanceof RegExp` FALSE).
   */
  #wrapRegExp(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const source = Scope.withScope((scope) =>
      ctx.getString(scope.manage(ctx.getProp(handle, 'source'))),
    );
    const flags = Scope.withScope((scope) =>
      ctx.getString(scope.manage(ctx.getProp(handle, 'flags'))),
    );
    const mirror = new RegExp(source, flags);
    Object.setPrototypeOf(mirror, this.#exoticProtoFor('RegExp', RegExp.prototype));
    this.#retainForWrapper(mirror, handle, id);
    return mirror;
  }

  // ===========================================================================
  // Error marshalling (T11).
  // ===========================================================================

  /**
   * Marshal a guest completion ERROR (the `{error}` handle from `evalCode` /
   * `callFunction`) to a host THROWABLE, WITHOUT `unwrapResult` (which disposes
   * the handle): the engine inspects the `{error}` handle, calls this, disposes
   * the handle, then `throw`s the returned value. NON-Error throws (`throw 42`,
   * `throw "str"`, `throw {custom:1}`) are NOT error-shaped, so they fall through
   * to the normal `wrapGuestToHost` (a caught `42` is the primitive `42`, Node-
   * faithful). An Error-branded object routes to `#wrapError` (identity-cached).
   * Never disposes `handle` — the caller owns it (mirrors `wrapGuestToHost`).
   */
  wrapGuestError(handle: QuickJSHandle): unknown {
    return this.wrapGuestToHost(handle);
  }

  /**
   * OUT Error mirror — a REAL host Error backing (a genuine catchable/rethrowable
   * value carrying a `.stack`) whose own `name`/`message`/`stack` are copied from
   * the guest error, with a per-ctor-name FLAT proto (`#errorProtoFor`) so:
   *   - `instanceof Error`/`TypeError` FALSE (proto is NOT host `Error.prototype`),
   *   - `.constructor.name` faithful (synthetic ctor on the flat proto),
   *   - `.name`/`.message`/`.stack` faithful (own props from the guest),
   *   - `e.toString()` faithful (host `Error.prototype.toString` on the flat proto
   *     reads the own `name`/`message`).
   * Mirrors Node's cross-realm error shape (verified oracle, `vm/quickjs-errors`).
   * The guest handle is retained for identity/round-trip like other wrappers.
   */
  #wrapError(handle: QuickJSHandle, id: number): unknown {
    const ctx = this.#ctx;
    const readStr = (key: string): string =>
      Scope.withScope((scope) => {
        const h = scope.manage(ctx.getProp(handle, key));
        return ctx.typeof(h) === 'string' ? ctx.getString(h) : '';
      });
    const name = readStr('name');
    const message = readStr('message');
    const stack = readStr('stack');
    // Guest `constructor.name` drives the host mirror's `.constructor.name`
    // (faithful even for a custom subclass whose `.name` was reassigned).
    const ctorName = Scope.withScope((scope) => {
      const ctor = scope.manage(ctx.getProp(handle, 'constructor'));
      const cn = scope.manage(ctx.getProp(ctor, 'name'));
      return ctx.typeof(cn) === 'string' ? ctx.getString(cn) : 'Error';
    });
    // Real host Error backing so the value is genuinely throwable + has a `.stack`
    // slot; own props then override name/message/stack with the GUEST's values.
    const mirror = new Error(message);
    Object.defineProperty(mirror, 'message', {
      value: message,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(mirror, 'name', { value: name, writable: true, configurable: true });
    Object.defineProperty(mirror, 'stack', { value: stack, writable: true, configurable: true });
    Object.setPrototypeOf(mirror, this.#errorProtoFor(ctorName));
    this.#retainForWrapper(mirror, handle, id);
    return mirror;
  }

  /**
   * Shared host prototype for an OUT error mirror of guest ctor `ctorName`. A
   * null-based flat proto carrying the host `Error.prototype` chain methods
   * (`toString` …, excluding `name`/`message` so the mirror's OWN values win) PLUS
   * a synthetic `constructor` whose `.name === ctorName` — so `e.constructor.name`
   * is faithful and `e.toString()` works, while `instanceof Error` is FALSE (the
   * proto is NOT host `Error.prototype`). One proto per ctor name, reused.
   */
  #errorProtoFor(ctorName: string): object {
    const cached = this.#errorProtos.get(ctorName);
    if (cached) return cached;
    const proto = Object.create(null) as Record<PropertyKey, unknown>;
    for (
      let p: object | null = Error.prototype;
      p !== null && p !== Object.prototype;
      p = Object.getPrototypeOf(p)
    ) {
      for (const key of Object.getOwnPropertyNames(p)) {
        // `name`/`message` belong to the mirror's OWN props (the guest values);
        // `constructor` is replaced with the synthetic one below.
        if (key === 'constructor' || key === 'name' || key === 'message') continue;
        if (Object.prototype.hasOwnProperty.call(proto, key)) continue;
        Object.defineProperty(
          proto,
          key,
          Object.getOwnPropertyDescriptor(p, key) as PropertyDescriptor,
        );
      }
    }
    // Synthetic constructor: only its `.name` is observed (`e.constructor.name`);
    // it is NOT a host Error ctor, so `e.constructor !== host TypeError` (Node-
    // faithful cross-realm). Non-enumerable, matching a real `constructor` slot.
    const ctor = { name: ctorName };
    Object.defineProperty(proto, 'constructor', {
      value: ctor,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    this.#errorProtos.set(ctorName, proto);
    return proto;
  }

  /**
   * Marshal a thrown HOST value INTO the guest as a guest exception handle (T11),
   * for a host fn that threw while called from the guest. The caller (`newFunction`
   * impl) `throw`s the returned handle; `newFunction` TRANSFERS ownership to quickjs
   * — so this returns an OWNED handle the caller must NOT dispose.
   *
   * An Error-shaped host throw becomes a REAL guest error of the matching ctor
   * (`globalThis[ctorName]`, e.g. `RangeError`) so guest `e.constructor.name`/
   * `e.message`/`e.name` are faithful (verified oracle). A NON-Error host throw
   * (a host `throw 42`/`"str"`/object) marshals straight through `marshalHostToGuest`
   * as the raw guest value — guest `catch` sees the primitive/object, not an Error.
   */
  #guestErrorFromHost(value: unknown): QuickJSHandle {
    const ctx = this.#ctx;
    if (!(value instanceof Error)) return this.marshalHostToGuest(value);
    // Factory: `new globalThis[name](msg)` if that ctor exists, else a plain Error.
    // Then overwrite `.name` so a custom error (ctor `Error` but `.name` reassigned)
    // keeps its `.name` in the guest (mirrors how the host carries it).
    const factory = this.#exoticFactory(
      '(name, msg, nm) => { const C = globalThis[name]; const e = (typeof C === "function") ? new C(msg) : new Error(msg); e.name = nm; return e; }',
    );
    const ctorName = value.constructor?.name ?? 'Error';
    return Scope.withScope((scope) => {
      const nameH = scope.manage(ctx.newString(ctorName));
      const msgH = scope.manage(ctx.newString(value.message));
      const nmH = scope.manage(
        ctx.newString(typeof value.name === 'string' ? value.name : ctorName),
      );
      return ctx.unwrapResult(ctx.callFunction(factory, ctx.undefined, nameH, msgH, nmH));
    });
  }

  /**
   * OUT TypedArray mirror — a REAL host typed array of the matching kind + values
   * (carries the [[TypedArrayName]] slot → brand `[object Uint8Array]`, indexing,
   * `.length`, `Array.from`, `ArrayBuffer.isView` TRUE) with the shared severed
   * proto (`instanceof Uint8Array`/`Object` FALSE). Built leak-safe: the guest
   * handle is tracked BEFORE the throwable element reads (`#retainForWrapper`).
   */
  #wrapTypedArray(handle: QuickJSHandle, id: number, kind: TypedArrayKind): unknown {
    const ctx = this.#ctx;
    const length = ctx.getLength(handle) ?? 0;
    const Ctor = TYPED_ARRAY_CTORS[kind];
    const isBig = kind === 'BigInt64Array' || kind === 'BigUint64Array';
    const mirror = new Ctor(length) as TypedArrayInstance;
    // Use the kind's flat proto on the host: severed from the host ctor chain so
    // `instanceof` is FALSE, but TypedArray index/length come from the internal
    // slot on the REAL backing, not the proto.
    Object.setPrototypeOf(mirror, this.#exoticProtoFor(kind, Ctor.prototype));
    this.#retainForWrapper(mirror, handle, id);
    try {
      for (let i = 0; i < length; i++) {
        const elemH = ctx.getProp(handle, i);
        try {
          // Index assignment bypasses the severed proto (it is a [[Set]] on the
          // exotic integer-indexed slot) — works on the real backing.
          (mirror as unknown as Record<number, number | bigint>)[i] = isBig
            ? ctx.getBigInt(elemH)
            : ctx.getNumber(elemH);
        } finally {
          elemH.dispose();
        }
      }
    } catch (err) {
      this.#lifetime.releaseWrapper(mirror);
      throw err;
    }
    return mirror;
  }

  /**
   * Marshal a host Date/RegExp/TypedArray INTO the guest as a REAL guest exotic with
   * a SEVERED prototype (so `instanceof guestCtor` is FALSE — cross-realm, like
   * Node) but correct brand/methods/data. Returns undefined for a non-exotic host
   * object (caller falls through to the generic seed). Identity-cached + host-origin
   * recorded, exactly like `#marshalInboundObject`, so round-trip + re-marshal hold.
   */
  #marshalInboundExotic(value: object): QuickJSHandle | undefined {
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    // Cache lookup BEFORE constructing a fresh guest exotic (avoid the throwaway).
    const cached = this.#inboundGuest.get(value);
    if (cached) {
      // Re-marshal of a previously-seeded host exotic: hand back the cached guest
      // identity. Exotic VALUE refresh between runs is the documented residual
      // (matches the object seed's structural-removal residual) — data is
      // snapshotted at first seed; deep value-mutation refresh is revisited if a
      // parity case demands it (see file doc).
      return cached.dup();
    }
    let seed: QuickJSHandle | undefined;
    if (tag === 'Date') seed = this.#guestDateFromHost(value as Date);
    else if (tag === 'RegExp') seed = this.#guestRegExpFromHost(value as RegExp);
    else if (TYPED_ARRAY_BRANDS.has(tag)) {
      seed = this.#guestTypedArrayFromHost(
        value as TypedArrayInstance,
        TYPED_ARRAY_BRANDS.get(tag) as TypedArrayKind,
      );
    }
    if (seed === undefined) return undefined;
    this.#hostOrigins.set(this.#idOf(seed), value);
    // Rebrand: a FLAT guest proto (not the guest intrinsic prototype) so
    // `instanceof guestCtor` is FALSE while brand/methods stay faithful — symmetric
    // with the OUT host-side mirror + Node's cross-realm IN behavior. (NOT a null
    // proto — that would strip the methods, unlike a generic seed.)
    this.#rebrandGuestExotic(seed, tag);
    this.#inboundGuest.set(value, seed);
    this.#lifetime.trackInfra(seed);
    return seed.dup();
  }

  /**
   * Set a guest exotic seed's [[Prototype]] to a null-based flat proto carrying the
   * `kind`'s prototype-chain methods (via the unreachable `EXOTIC_REBRAND_BOOTSTRAP`
   * closure) so `instanceof guestCtor` is FALSE but methods/brand/data work.
   */
  #rebrandGuestExotic(handle: QuickJSHandle, kind: string): void {
    const ctx = this.#ctx;
    if (!this.#rebrandHandle) {
      this.#rebrandHandle = ctx.unwrapResult(ctx.evalCode(EXOTIC_REBRAND_BOOTSTRAP));
      this.#lifetime.trackInfra(this.#rebrandHandle);
    }
    Scope.withScope((scope) => {
      const kindH = scope.manage(ctx.newString(kind));
      scope.manage(
        ctx.unwrapResult(
          ctx.callFunction(this.#rebrandHandle as QuickJSHandle, ctx.undefined, handle, kindH),
        ),
      );
    });
  }

  /**
   * Cached guest factory fn for IN exotic construction (no `callConstructor` in the
   * API). Evals `source` once → an infra-tracked guest fn handle, reused thereafter.
   */
  #exoticFactory(source: string): QuickJSHandle {
    const cached = this.#exoticFactories.get(source);
    if (cached) return cached;
    const ctx = this.#ctx;
    const fn = ctx.unwrapResult(ctx.evalCode(source));
    this.#exoticFactories.set(source, fn);
    this.#lifetime.trackInfra(fn);
    return fn;
  }

  /** Build a guest Date with the host Date's epoch. Caller owns the returned handle. */
  #guestDateFromHost(value: Date): QuickJSHandle {
    const ctx = this.#ctx;
    const factory = this.#exoticFactory('(t) => new Date(t)');
    return Scope.withScope((scope) => {
      const t = scope.manage(ctx.newNumber(value.getTime()));
      return ctx.unwrapResult(ctx.callFunction(factory, ctx.undefined, t));
    });
  }

  /** Build a guest RegExp from the host RegExp's source/flags. Caller owns the handle. */
  #guestRegExpFromHost(value: RegExp): QuickJSHandle {
    const ctx = this.#ctx;
    const factory = this.#exoticFactory('(s, f) => new RegExp(s, f)');
    return Scope.withScope((scope) => {
      const src = scope.manage(ctx.newString(value.source));
      const flags = scope.manage(ctx.newString(value.flags));
      return ctx.unwrapResult(ctx.callFunction(factory, ctx.undefined, src, flags));
    });
  }

  /** Build a guest TypedArray of the matching kind + values. Caller owns the handle. */
  #guestTypedArrayFromHost(value: TypedArrayInstance, kind: TypedArrayKind): QuickJSHandle {
    const ctx = this.#ctx;
    const isBig = kind === 'BigInt64Array' || kind === 'BigUint64Array';
    const factory = this.#exoticFactory(`(len) => new ${kind}(len)`);
    const len = ctx.newNumber(value.length);
    let ta: QuickJSHandle;
    try {
      ta = ctx.unwrapResult(ctx.callFunction(factory, ctx.undefined, len));
    } finally {
      len.dispose();
    }
    try {
      for (let i = 0; i < value.length; i++) {
        const elem = value[i] as number | bigint;
        const elemH = isBig ? ctx.newBigInt(elem as bigint) : ctx.newNumber(elem as number);
        try {
          ctx.setProp(ta, i, elemH);
        } finally {
          elemH.dispose();
        }
      }
    } catch (err) {
      ta.dispose();
      throw err;
    }
    return ta;
  }

  // ===========================================================================
  // Symbol marshalling (T10), both directions.
  // ===========================================================================

  /**
   * Marshal a guest symbol OUT to a host symbol matching Node's cross-realm rules:
   *   - WELL-KNOWN (`Symbol.iterator` …) → the HOST well-known (SHARED, `===`);
   *   - REGISTRY (`Symbol.for(k)`) → `Symbol.for(k)` (SHARED, `===`);
   *   - UNIQUE → a fresh host symbol with the same description, identity-cached by
   *     the guest symbol's registry id (same guest symbol → same host symbol), and
   *     recorded for the round-trip IN (`#outSymbolOrigin`).
   */
  #wrapSymbol(handle: QuickJSHandle): symbol {
    const ctx = this.#ctx;
    // Well-known: compare against each host well-known via `ctx.eq`.
    const wk = this.#wellKnownNameOf(handle);
    if (wk !== undefined) return Symbol[wk];
    // Registry: `Symbol.keyFor` returns a string for registry symbols, else undefined.
    const regKey = this.#symbolRegistryKey(handle);
    if (regKey !== undefined) return Symbol.for(regKey);
    // Unique: identity-cache by the guest symbol id.
    const id = this.#idOf(handle);
    // Round-trip: a guest unique symbol we seeded FROM a host symbol → that host
    // symbol (so a host symbol → guest → host is `=== hostSym`).
    const origin = this.#symbolOrigins.get(id);
    if (origin !== undefined) return origin;
    const cached = this.#outSymbols.get(id);
    if (cached) return cached;
    const desc = Scope.withScope((scope) => {
      const d = scope.manage(ctx.getProp(handle, 'description'));
      return ctx.typeof(d) === 'string' ? ctx.getString(d) : undefined;
    });
    const mirror = Symbol(desc);
    this.#outSymbols.set(id, mirror);
    // Retain the guest handle so the host mirror symbol can be used as a KEY back
    // into the guest (`#guestSymbolHandleFor`) and resolve to THIS guest symbol.
    const dup = handle.dup();
    this.#outSymbolGuest.set(mirror, dup);
    this.#lifetime.trackInfra(dup);
    return mirror;
  }

  /** Well-known symbol NAME a guest symbol matches (via `ctx.eq` vs each host well-known), or undefined. */
  #wellKnownNameOf(handle: QuickJSHandle): (typeof WELL_KNOWN_SYMBOL_NAMES)[number] | undefined {
    const ctx = this.#ctx;
    for (const name of WELL_KNOWN_SYMBOL_NAMES) {
      const wk = ctx.getWellKnownSymbol(name);
      try {
        if (ctx.eq(handle, wk)) return name;
      } finally {
        wk.dispose();
      }
    }
    return undefined;
  }

  /** `Symbol.keyFor(handle)` → registry key string, or undefined for non-registry symbols. */
  #symbolRegistryKey(handle: QuickJSHandle): string | undefined {
    const ctx = this.#ctx;
    return Scope.withScope((scope) => {
      const symbolCtor = scope.manage(ctx.getProp(ctx.global, 'Symbol'));
      const keyFor = scope.manage(ctx.getProp(symbolCtor, 'keyFor'));
      const r = scope.manage(ctx.unwrapResult(ctx.callFunction(keyFor, ctx.undefined, handle)));
      return ctx.typeof(r) === 'string' ? ctx.getString(r) : undefined;
    });
  }

  /**
   * Marshal a host symbol INTO the guest matching Node's rules:
   *   - a host mirror symbol we minted OUT round-trips to its ORIGINAL guest symbol
   *     (`#outSymbolOrigin` → the guest handle, so `=== hostSym` holds back in host);
   *   - WELL-KNOWN host symbol → the guest well-known (`getWellKnownSymbol`, SHARED);
   *   - REGISTRY host symbol → `newSymbolFor(key)` (SHARED);
   *   - UNIQUE host symbol → a fresh guest unique symbol with the same description,
   *     identity-cached + host-origin recorded so the guest symbol round-trips back
   *     to THIS host symbol.
   */
  #marshalInboundSymbol(value: symbol): QuickJSHandle {
    const ctx = this.#ctx;
    // Identity: the same host unique symbol → the same guest handle (so a round-trip
    // OUT recovers this host symbol via `#symbolOrigins`).
    const cached = this.#inboundSymbols.get(value);
    if (cached) return cached.dup();
    // Well-known: a host well-known symbol → the guest's (shared identity).
    const wkName = WELL_KNOWN_SYMBOL_NAMES.find((n) => Symbol[n] === value);
    if (wkName !== undefined) return ctx.getWellKnownSymbol(wkName);
    // Registry: `Symbol.keyFor` on the host → guest `newSymbolFor` (shared).
    const regKey = Symbol.keyFor(value);
    if (regKey !== undefined) return ctx.newSymbolFor(regKey);
    // Unique: mint a guest unique symbol, identity-cache + record host origin so the
    // round-trip OUT (`#wrapSymbol`) recovers THIS host symbol.
    const guestSym = ctx.newUniqueSymbol(value.description ?? '');
    this.#symbolOrigins.set(this.#idOf(guestSym), value);
    this.#inboundSymbols.set(value, guestSym);
    this.#lifetime.trackInfra(guestSym);
    return guestSym.dup();
  }

  /**
   * Host symbol → a TRANSIENT guest symbol handle for a symbol-keyed READ (the
   * object wrapper's traps). Caller OWNS + disposes it. Reuses the inbound symbol
   * marshaller; for unique symbols already seeded it returns a dup of the cached
   * guest handle.
   */
  #guestSymbolHandleFor(value: symbol): QuickJSHandle {
    // A host mirror symbol we minted OUT (a guest symbol key surfaced to the host)
    // → a dup of the ORIGINAL guest symbol handle, so the read hits the right key.
    const out = this.#outSymbolGuest.get(value);
    if (out) return out.dup();
    // Otherwise it is a genuine host symbol (well-known/registry/unique) → marshal IN.
    return this.#marshalInboundSymbol(value);
  }

  /**
   * Copy the guest fn's `name`/`length` onto the host thunk so the OUT function
   * wrapper reports the GUEST fn's values (Node: a returned guest fn has the guest
   * fn's name + length, not the thunk's `'thunk'`/0). Both are own configurable
   * properties on a function — `defineProperty` overrides them.
   */
  #copyFnNameLength(handle: QuickJSHandle, thunk: (...args: unknown[]) => unknown): void {
    const ctx = this.#ctx;
    const name = Scope.withScope((scope) => {
      const n = scope.manage(ctx.getProp(handle, 'name'));
      return ctx.typeof(n) === 'string' ? ctx.getString(n) : '';
    });
    const length = Scope.withScope((scope) => {
      const l = scope.manage(ctx.getProp(handle, 'length'));
      return ctx.typeof(l) === 'number' ? ctx.getNumber(l) : 0;
    });
    Object.defineProperty(thunk, 'name', { value: name, configurable: true });
    Object.defineProperty(thunk, 'length', { value: length, configurable: true });
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
