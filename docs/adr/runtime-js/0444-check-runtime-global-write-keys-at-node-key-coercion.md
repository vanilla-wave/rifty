# ADR 0444: Check runtime global-write keys at Node's key coercion

Status: Accepted
Date: 2026-09-23

> TL;DR: A non-constant key of a guarded global write/define/delete is checked when V8 coerces it, via a per-module helper; only a key that is `'Function'` throws the existing named ceiling — at the write, not at load.

Adds a decision on the seam ADR-0171 §4 owns (global `Function` mutation stays
a loud ceiling); nothing in ADR-0171 is overturned. Replaces the vitest goal's
carrier note (static Symbol-key proof; see Alternatives).

## Context

The ESM/CJS Function guards reject a module at load when a write, define or
delete on a statically tracked global object (`globalThis`, `global`, their
tracked aliases) uses a computed key they cannot fold to a string: the key
might be `'Function'`. vitest 4.1.11 loads six such ESM modules
(`docs/backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md`
§S1/§S2): Symbol-const keys (`@vitest/utils` timers, `@vitest/expect`), an
imported Symbol binding and `vi.stubGlobal`/`unstubAllGlobals` parameter keys
(test chunk), and `for (const key in config.defines) globalThis[key] = …`
(setup-common, imported by both pool workers). undici's `lib/global.js` is the
CJS twin. Node writes them all (§O1/§O2). A key that is `'Function'` replaces
Node's global constructor (§O3); rifty runs guest modules in the browser host
realm, where that write would corrupt the host constructor.

## Decision

1. A key expression of such a single-key site — member assignment, compound or
   logical assignment, update, `delete`, destructuring/for-in/of target,
   `Object.defineProperty`, `Reflect.set|defineProperty|deleteProperty`,
   `__defineGetter__`/`__defineSetter__` — that does not fold to a constant is
   no longer a load-time ceiling. The loaders wrap it in a per-module
   key-check helper passed as a module-wrapper parameter: CJS through its
   guard's rewrite edits, ESM by editing the source before the ESM rewrite.
2. The helper returns a primitive key other than the string `'Function'`
   unchanged. For `'Function'` and object/function keys it returns a coercion
   proxy whose `Symbol.toPrimitive` runs the key's ToPropertyKey once and
   throws the module format's existing
   `NotImplementedError('module-loader.{esm,cjs}-global-function-assignment')`
   when the result is `'Function'`, else returns that key. V8 coerces the
   proxy exactly where and as often as it coerces the original key (§O4/§O5),
   so Node's coercion order and count hold and the ceiling fires at the
   operation's key coercion, before any mutation.
3. Unchanged load-time ceilings: keys folding to `'Function'`; `Object.assign`
   / `Object.defineProperties` with non-literal sources; spread arguments;
   runtime-key reads used as a constructor (`new globalThis[k](…)`,
   `Reflect.get(globalThis, k)` then called).

## Alternatives

- Static Symbol proof (goal carrier note; PR #352 route): killed — parameter,
  for-in and imported-binding keys on the claimed path are not statically
  provable (§S2), and both pools import them.
- Exempt identifier keys statically (PR #349 route): killed —
  `stubGlobal('Function', X)` would replace the host constructor (§O3).
- Eager ToPropertyKey at the key position: killed — Node coerces an assignment
  key after its RHS and a compound key twice (§O5: eager `["key","rhs"]` vs
  Node `["rhs","key"]`).
- Throw for every object key: loud but a false ceiling on keys Node writes,
  plus a new feature id; the coercion proxy costs the same helper.
- Accessor/non-configurable `globalThis.Function` in the host realm: realm-wide
  mutation shared with runtime infra, Node's data-property descriptor changes,
  `defineProperty`/`delete` fail with `TypeError`/`false`, not the ceiling.
- Global membrane or isolated realm (`runtime-js/cjs-global-function-assignment`):
  out of scale for this contract.

## Consequences

- (+) vitest's worker, API and utils modules and undici load; a runtime
  `'Function'` key still throws the named ceiling, host `Function` intact.
- (-) For runtime keys the ceiling fires at the write, not at load: earlier
  statements of the module have run, as with any runtime `NotImplementedError`.
- (-) `fn.toString()` and stack columns on a rewritten line show the helper —
  the existing source-rewrite class (ADR-0009, ADR-0171).
- (-) Over-approximation kept: a tracked alias rebound to another object still
  throws for key `'Function'`; `globalThis[k] ??= v` / `||=` with `k` of
  `'Function'` throws at its read coercion although Node would skip the write
  (the proxy cannot tell a read coercion from a write one); a patched
  `Object.defineProperty`/`Reflect.*` receives the proxy, not the original
  object, for `'Function'`/object keys.
- Guard: parity cases `modules/global-computed-key-{writes,sites}-{esm,cjs}`;
  conformance `tests/conformance/modules/global-computed-key-guard{,-sites}.test.ts`.
