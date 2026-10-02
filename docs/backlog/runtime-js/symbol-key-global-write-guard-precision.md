---
area: runtime-js
status: ready
title: ESM/CJS Function guards accept `globalThis[<Symbol const>]` writes (@vitest/utils, undici)
created: 2026-09-15
why: the finite guard flags any computed-key write/defineProperty on globalThis as a possible `Function` mutation; `globalThis[SAFE_TIMERS_SYMBOL] = timers` (@vitest/utils) and `Object.defineProperty(globalThis, Symbol.for('undici.globalDispatcher.2'), …)` (undici, hence jsdom) are rejected as `module-loader.{esm,cjs}-global-function-assignment` although a Symbol-valued key can never be the string 'Function'
user_story: As a developer running vitest in the browser shell, I want @vitest/utils' timers stash and undici's globalDispatcher defineProperty to load, but today the test worker dies at import with `module-loader.esm-global-function-assignment` on a key that provably is not 'Function'
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/cjs-global-function-assignment.md, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

`esm.ts` `isGlobalFunctionWriteMember` treats `propertyName === undefined &&
isComputedMember` as a Function write; `isGlobalFunctionMutationCall` does the
same for `Object.defineProperty(globalThis, <non-literal>, …)`; `cjs.ts`
carries the twins. Observed: vitest 3.2.7 CLI dies at import; vitest 4 hits it
in the test worker (`@vitest/utils/dist/timers.js`); `import('jsdom')` dies in
undici. The existing ceiling item
(`cjs-global-function-assignment`) keeps dynamic `globalThis[...]` mutation
loud when the key MAY be 'Function'; this item refines "may": a key provably
Symbol-valued can never be the string 'Function' (nor 'eval').

RED baseline (probed 2026-10-01 on the epic branch, module-loader in-process):
THROWS today — direct write `globalThis[Symbol.for('x')] = v`, const-alias
write, `Reflect.set`, `Object.assign(globalThis, { [K]: v })`,
`Object.defineProperties`, `Object.defineProperty`, `delete globalThis[K]`,
CJS twins. PASSES today (unchanged): plain alias read-back
`const v = globalThis[K]`, member access and method call `globalThis[K].f()`
on the stashed object (the R1 record listed the method call as THROWS —
wrong; its RED was masked by the write in the same module), and read-only
`Reflect.get(globalThis, K)` (calling the read result throws —
constructor-read taint, stays).

Provable rule (both loaders, one helper each): a computed key is NOT
Function/'eval'-suspect when it is
- a `Symbol(...)` or `Symbol.for(...)` call with module-scope-unshadowed
  `Symbol` (existing `isGuardShadowed` machinery), or
- an Identifier bound by `const` (same scope chain) to one of the above
  (new `symbolKeyAliases` scope set mirroring the existing alias trackers;
  `let`/`var` bindings are NOT marked — reassignment keeps them unknown).

`Symbol.keyFor` returns a string, not a symbol — NOT accepted. A shadowed
`Symbol` (e.g. a function parameter named `Symbol`) keeps every pattern loud.
So does a module that OBSERVABLY substitutes the intrinsic (Final+GREEN R1
F1 — lexical unshadowed ≠ unchanged intrinsic): bare/member/global-target
assignment or delete on unshadowed `Symbol` (`Symbol = …`, `Symbol.for = …`,
`globalThis.Symbol = …`), the same member forms THROUGH the global object
(`globalThis.Symbol.for = …` names the real intrinsic even when a local
binding shadows the identifier — R2 F1), sequence/paren-wrapped references
(`(0, Symbol).for = …` — R3 F2), destructuring targets
(`[Symbol.for] = […]`, `({for: Symbol.for} = …)` — R3 F1), a
defineProperty-family call on `Symbol`/`globalThis.Symbol`,
`Object.setPrototypeOf`/`Reflect.setPrototypeOf` on the intrinsic
(prototype injection + own-property delete — R3 F4), a const-bound alias of
the intrinsic itself (`const S = Symbol; S.for = …` — R3 self-sweep;
let/var aliases stay untracked, reassignment makes them may-alias — the
exhaustive ceiling's), a literal `'Symbol'` key through the global object,
or `__defineGetter__/__defineSetter__` on either — detected source-ordered like the existing alias trackers, then
`Symbol` reports as shadowed for the rest of the walk. A tamper carrier
nested INSIDE a mutation key expression runs before the write/call
completes, so the key interior is walked with the full guard machinery
(scopes, patterns, delete) before the proof is consulted (R2 F2, R3
F1/F3/F4 — the sequence unwrap must not discard the mutation, and a
tamper-shaped assignment scoped to a nested function's OWN Symbol binding
is a local mutation, never tamper). Inside a `with` body no Symbol key is
provable — a dynamic scope may shadow Symbol (R3 F5, CJS-only: the ESM
loader parses `sourceType: 'module'`, strict — `with` is a SyntaxError
before the guard runs, so the ESM twin carries no withDepth). A genuine Symbol-key write BEFORE any tamper stays exempt
(source order, R2 C1); `Symbol++`-class updates yield NaN and cannot mint
a 'Function' key, so they stay untracked. eval-text Symbol substitution is
out of scope here — owned by
`function-constructor-exhaustive-metaprogramming-ceiling` (R3 C3).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. ESM parity: the @vitest/utils shape — `const SAFE = Symbol.for('…');
   globalThis[SAFE] = timers`, read-back, and method call
   `globalThis[SAFE].setTimeout(…)` — compiles and runs with Node-identical
   output; the undici shape `Object.defineProperty(globalThis,
   Symbol.for('undici.globalDispatcher.2'), …)` runs → I6
2. CJS parity: the same two shapes through `cjs.ts` run with Node-identical
   output — the carrier covers defineProperty with a const alias AND with a
   direct `Symbol.for(...)` key (the alias cannot discriminate a
   direct-key-only regression) → I6
3. Ceiling unchanged (regression): string-literal, concatenated-string,
   unknown-identifier, `let`-bound-symbol, and shadowed-`Symbol` computed keys
   still throw `module-loader.{esm,cjs}-global-function-assignment` — pinned
   in BOTH loaders (a CJS let-allowing mutant must die); a
   `Reflect.get(globalThis, K)` result with provable-Symbol `K` stays
   tainted — calling it throws (mutation-only exemption, read ceiling
   untouched) — pinned in BOTH loaders; the
   existing conformance pins (`tests/conformance/modules/resolver.test.ts`
   Function-assignment describe) stay green → I6 honesty
4. `Reflect.set`/`Object.assign`/`Object.defineProperties`/`delete` with
   provable Symbol keys stop throwing in BOTH loaders (parity + unit) → I6
5. The compat note for the ceiling (`docs/public/compat/modules.md`, the
   `module-loader.{esm,cjs}-global-function-assignment` row) is refined to
   state the Symbol-key exception → I6 honesty

## Reference contract

- Oracle: Node v24.16.0 (host) — Node has no such guard; the patterns simply
  run. Parity `expected` pinned from the oracle, never from memory.
- Mechanism: the provably-Symbol-key machinery lives ONCE in the new sibling
  `module-loader/symbol-key-guard.ts` (`isProvablySymbolKey`,
  `mutationKeyMayBeFunction`, `objectMayContainFunctionKey`, alias
  mark/is/update over a structural `SymbolKeyScope` + a shadow-probe
  callback), consulted by BOTH loader twins at MUTATION key positions only,
  exactly three site families: `isGlobalFunctionWriteMember` (direct writes
  AND `delete` — delete routes through `walkGuardAssignmentTarget`), the
  mutation key arguments inside `isGlobalFunctionMutationCall`
  (defineProperty / Reflect.set / Reflect.deleteProperty /
  `__defineGetter__` / `__defineSetter__`), and
  `objectMayContainFunctionKey` (defineProperties / Object.assign literal
  keys). The twins' byte-identical guard-AST helpers (`unwrapGuardChain`,
  `literalString`, `staticPropertyName`, `staticPropertyKeyName`,
  `isComputedMember`, `propertyMayBeFunction`, `propertyMayBeConstructor`)
  are deduplicated into `module-loader/guard-ast.ts`, which both twins
  import. Layout amendment (2026-10-01, post-R3): the R3-contracted
  per-twin helper copies cannot land — the file-size ratchet pins esm.ts at
  1568 (4 lines headroom) and cjs.ts at 2052 (11); the sibling split follows
  the fs-statfs.ts pattern and shrinks both twins under their pins.
  READ sites keep the UNCHANGED conservative helpers: a
  Symbol key proves the KEY, never the VALUE — the slot may hold a host
  Function, so `Reflect.get(globalThis, K)` keeps its result taint
  (`isReflectGetFunctionCall` → constructor-read ceiling; probed
  2026-10-01: read-only Reflect.get passes, calling the result throws
  `module-loader.esm-global-function-assignment`). Plain computed reads,
  member access and method calls on a stashed object pass today without any
  exemption (the R1-contract claim that the method-call pattern needs the
  read site was wrong; its RED was masked by the write in the same module).
- Scope discipline: `let`/`var`-bound and shadowed keys stay loud — the
  claimed evidence (@vitest/utils, undici) uses `const` only.

## Parity cases

1. Node v24.16.0 ESM carrier
   `tools/node-parity-runner/cases/modules/symbol-key-global-write-esm.case.ts`:
   const-alias write + read-back, method call through the stashed object,
   defineProperty with a direct `Symbol.for(...)` key, a `Symbol('local')`
   write, and a provable-key `delete` — `expected` oracle-pinned → I6
2. Node v24.16.0 CJS carrier
   `tools/node-parity-runner/cases/modules/symbol-key-global-write-cjs.case.ts`:
   the undici defineProperty shape (alias AND direct key), the @vitest/utils
   stash shape (const-alias write/read-back AND a method call on the stashed
   object), Reflect.set / Object.assign / Object.defineProperties,
   and full key cleanup → I6

Unit REDs (guard precision): `tests/conformance/modules/symbol-key-global-write.test.ts`
— 28 positive carriers (Acceptance 1/2/4 patterns compile and run in both
loaders, incl. an export-wrapped `export const K = Symbol.for(…)` alias,
a CJS stash method call, a shadowed-local scope control, a
write-before-tamper source-order control, and a key-interior
nested-function local-Symbol control — RED today — plus the
export-wrapped `globalThis`-alias ceiling hole, see Decisions; R4 adds the
early-walk scope control with a FRESH Symbol.call (C1), the alias-replay
pair (F2), and the CJS key-interior edit-producer sweep (F1)) +
67 boundary pins (Acceptance 3 in BOTH loaders:
string-literal, concatenated, unknown-identifier, `let`-bound-symbol,
shadowed-`Symbol`, `Symbol.keyFor` keys stay loud, called
`Reflect.get(globalThis, K)` results stay loud, and the intrinsic-tamper
carriers stay loud — five R1 forms; per loader the R2 global-mediated
trio, the R2 key-sequence quartet plus defineProperties/__defineGetter__
key-interior pins (R3 C1), the R3 destructuring pair, the R3
wrapped-reference pair, the R3 prototype-injection form, the R3
const-intrinsic-alias pair, the R4 pure-setPrototypeOf / wrapped-global /
wrapped-define-callee / alias-callee forms; CJS-only the R3 `with`-shadowed
form and the R4 `with`-shadowed key-alias form — tamper
pins RED at their introducing round, the rest green today,
regression-only).

## Out of scope

- Widening to `let`/`var` alias tracking, `Symbol.keyFor`, well-known-symbol
  members (`Symbol.iterator` & friends — a fixed-list refinement the claimed
  evidence does not need), or user-defined `Symbol.foo` statics —
  conservative loud path stays.
- The remaining Function-constructor ceiling
  (`function-constructor-exhaustive-metaprogramming-ceiling`) and the global
  Function-assignment ceiling itself (`cjs-global-function-assignment`) —
  unchanged for every key that may be 'Function'.
- Read/eval/callee guard sites (`isGlobalFunctionUnknownReadMember`,
  `isGlobalEvalCallMember`, `guardCalleeMayBeHostFunction`): probed not loud
  for the claimed shapes, so unchanged — calling a Symbol-keyed global
  (`globalThis[K]()`) stays on the conservative path.

## Decisions

- 2026-10-01 — `const`-only alias marking: `let`/`var` stay unknown (loud).
  The claimed evidence uses `const`; reassignment tracking would add
  machinery the contract is deliverable without (§Simplicity).
- 2026-10-01 — reception (REV-12) of Contract+RED R1 (blocker, F1–F6):
  F2 — the read/eval-site exemption mandate is CUT: probed on the branch,
  computed reads and method calls on a stashed object pass today (the R1
  RED was masked by the write in the same module); the helper consults only
  the three write/mutation site families. F1 — CJS carriers extended:
  direct-`Symbol.for` defineProperty + Reflect.set/Object.assign/
  defineProperties in both the parity case and the unit file. F3 —
  export-wrapped const alias carrier added; alias marking is
  Identifier-pattern-only (destructuring/defaults never marked), lookup
  stops at the nearest binding (existing scope-stack machinery). F4 — CJS
  boundary pins added (string-literal/unknown/let-bound/shadowed) so a CJS
  let-allowing mutant dies. F5 — both parity cases now delete EVERY key they
  set. F6 — compat-note refinement declared as Acceptance 5.
- 2026-10-01 — reception (REV-12) of Contract+RED R2 (blocker F2 + concern):
  the R2 mechanism premise "the value at a Symbol key is never the host
  Function" was FALSE — a Symbol key proves the key, never the value.
  Exemption limited to MUTATION key positions; `Reflect.get` keeps the
  conservative read taint, pinned by new boundary tests in both loaders
  (called result stays loud). Context baseline corrected: the method-call
  pattern passes today (R1 record was masked by the write). Implementation
  note (probed): `predeclareGuardLexicalScope` does not unwrap
  `ExportNamedDeclaration`, so export-wrapped consts never enter `bindings`
  and alias marking silently no-ops — IMPLEMENT unwraps export declarations
  in lexical predeclaration. Forced consequence, declared + pinned: the
  export-wrapped `globalThis`-alias ceiling hole closes (`export const g =
  globalThis; g.Function = fn` evades the guard today — probed; after the
  unwrap it throws, matching the non-export twin).
- 2026-10-01 — reception (REV-12) of Contract+RED R3 (concern, NOTE): the
  Acceptance-2 phrase "the same two shapes" could promise a CJS stash
  method call the CJS carriers never exercised. Closed by strengthening
  the proof, not the words: the CJS parity case gained the @vitest/utils
  stash-method-call carrier (`expected` re-pinned on host Node v24.16.0)
  and the unit file a CJS stash-method-call positive (16 → 17 RED). No
  read-site exemption follows from it.
- 2026-10-01 — layout amendment at IMPLEMENT: the symbol-key machinery lives
  in the new shared sibling `module-loader/symbol-key-guard.ts`, not as
  per-twin copies — the file-size ratchet pins esm.ts/cjs.ts at 1568/2052
  with 4/11 lines of headroom, so ~90 duplicated lines cannot land
  (fs-statfs.ts split pattern). The twins' byte-identical guard-AST helpers
  dedup into `module-loader/guard-ast.ts`. Behavior, site list, and
  boundaries unchanged from the R3-passed contract; cjs's markSymbolKeyAlias
  deliberately drops the local root-fallback convention (a never-registered
  binding must not exempt a key).
- 2026-10-02 — reception (REV-12) of Final+GREEN R1 (blocker, F1): lexical
  unshadowed ≠ unchanged intrinsic — `Symbol.for = () => 'Function'`,
  `Symbol = …`, `globalThis.Symbol = …`, or a defineProperty-family call on
  `Symbol` substitutes the intrinsic without a lexical binding, and the
  provable-key exemption then mints a 'Function' key. Fixed by observable-
  tamper detection (source-ordered, per the rule clause above): once any
  tamper carrier is walked, `Symbol` reports as shadowed for the rest of
  the module.   RED-pinned per loader (5 carriers each) + a shadowed-local
  scope control; CJS `Symbol.keyFor` pin added (R1 weak row).
- 2026-10-02 — reception (REV-12) of Final+GREEN R2 (blocker, F1/F2 +
  concern C1): F1 — the R1 detection missed the GLOBAL-mediated
  substitutions (`globalThis.Symbol.for = …`,
  `Object.defineProperty(globalThis.Symbol, 'for', …)`,
  `globalThis.__defineGetter__('Symbol', …)`); the new `isSymbolReference`
  helper names the intrinsic both ways (unshadowed identifier OR
  global-object member — the global form is the real intrinsic even under a
  shadowing local binding). F2 — a tamper carrier nested inside a mutation
  KEY expression (`globalThis[(Symbol.for = …, Symbol.for('x'))] = v` and
  the Reflect.set/defineProperty/Object.assign key positions) ran before
  the write but was scanned after the proof; `commitKeyExpressionTamper`
  now walks the key interior before every proof consultation at all five
  mutation-site families in both twins. C1 — source order was unpinned: a
  whole-module pre-scan mutant passed all tests; the write-before-tamper
  positive (both loaders) kills it.   RED-pinned: 7 stillLoud carriers per
  loader + 1 positive per loader (14 failed / 43 passed pre-fix, 57/57
  post-fix).
- 2026-10-02 — reception (REV-12) of Final+GREEN R3 (blocker, F1–F5 +
  concerns C1–C3): F1 — key-interior DESTRUCTURING targets
  (`[Symbol.for] = […]`) slipped the assignment-arm check. F2 —
  sequence/paren-wrapped intrinsic references (`(0, Symbol).for = …`)
  slipped isSymbolReference. F3 — the parallel key scanner used the
  enclosing scope probe inside nested functions, rejecting legitimate keys
  (false positive). F4 — `Object.setPrototypeOf(Symbol, {for})` + a
  key-interior `delete Symbol.for` opened an inherited fake. F5 — a CJS
  `with` scope can shadow Symbol dynamically, but the exemption ignored
  dynamic scope. Fix: the R2 parallel scanner is REPLACED by an early walk
  of the key subtree through the twins' own guard walk (scopes, patterns,
  delete, mutation calls — idempotent flags, in-order re-walk is a no-op),
  isSymbolReference/isSymbolTamperTarget unwrapGuardChain, a setPrototypeOf
  arm, and ctx.withDepth (both twins; ESM unreachable, twin symmetry).
  C1 — defineProperties/__defineGetter__ key-interior pins added per
  loader. C2 — defineProperty-key carriers made configurable so RED-state
  cleanup works. C3 — eval-text Symbol substitution routed to
  `function-constructor-exhaustive-metaprogramming-ceiling` (noted there).
  RED-pinned: 13 failed / 61 passed pre-fix (F1×4, F2×4, F3×2, F4×2,
  F5×1; the C1 pins are green-today regression pins), 74/74 post-fix.
- 2026-10-02 — pre-R4 self-sweep (REV-12, own adversarial pass before
  re-review): a const-bound alias of the intrinsic itself
  (`const S = Symbol; S.for = …`, `Object.defineProperty(S, 'for', …)`)
  substituted the real intrinsic undetected. Fixed by
  `symbolIntrinsicAliases` on the scope (const-only, cleared on shadow,
  same discipline as the key aliases) folded into a renamed
  `updateSymbolAliasesFromPatternValue`; the provable-key proof still
  rejects alias callees (no claimed evidence needs them). The ESM
  withDepth was removed as dead machinery (REV-7): the ESM loader parses
  strict (`sourceType: 'module'`), so `with` never reaches the guard.
  RED-pinned 4 failed / 74 passed pre-fix, 78/78 post-fix.
  Correction (2026-10-02, R4 F1/F2): the R3 "idempotent flags, in-order
  re-walk is a no-op" claim held only for the flag itself — the walk's
  alias marks and (CJS) pushed edits are NOT idempotent; see the R4 entry.
- 2026-10-02 — reception (REV-12) of Final+GREEN R4 (blocker, F1–F4):
  the early key walk became a true PROBE — `snapshotGuardScopeAliases` /
  `restoreGuardScopeAliases` around it restore every alias set (F2:
  a leaked `g = globalThis` mark turned an earlier-in-key local write into
  a host Function write on replay) and, in CJS, truncate `ctx.edits` back
  (F1: key-interior Function/WebAssembly references were rewritten twice —
  `__riftyFunction__riftyFunction` ReferenceError in real CJS execution).
  Only the monotonic tamper flag survives the probe. F3 — the global
  probes and the define-family callee/object positions unwrap
  sequence/chains: `(0, globalThis).Symbol.for = …` and
  `(0, Object).defineProperty(Symbol, …)` flag tamper. F4 — CJS threads
  `ctx.withDepth` into the proof: inside `with` NO key is provable (the
  const-key alias may be shadowed by a string). C1 — fresh-Symbol.call
  scope-control pins per loader; C2 — pure setPrototypeOf pins (the
  existing pin paired it with a key-interior delete, which flags
  independently); C4 — shadow/export RED carriers made host-safe (benign
  sentinels / write the real Function back); C5 — alias-callee still-loud
  pins (the proof keeps rejecting alias callees). C3 — the
  wrapped-callee/initializer closure is stated here: wrapped simple and
  transitive const initializers ARE tracked; Proxy-mediated globals,
  let/var/parameter/arguments alias flows stay beyond the declared
  provenance model (the exhaustive metaprogramming ceiling's).
  RED-pinned 8 failed / 87 passed pre-fix (F1×1 CJS multi-site, F2×2,
  F3×4, F4×1; the C1/C2/C5 pins are green-today mutant killers),
  95/95 post-fix.
