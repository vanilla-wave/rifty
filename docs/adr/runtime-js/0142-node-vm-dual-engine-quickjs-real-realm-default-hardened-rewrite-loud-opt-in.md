# ADR 0142: node:vm dual-engine — QuickJS real realm default, hardened-rewrite loud opt-in

Status: Accepted
Date: 2026-06

> TL;DR: supersedes ADR-0138 (removed; context grafted here). `node:vm` sandbox APIs (`runInNewContext`/`runInContext`/`Script.*`) now run in a REAL QuickJS-WASM realm by DEFAULT; the old host-realm `with(proxy)+eval(AST-rewrite)` engine is a LOUD opt-in (`vmEngine` host option / `__RIFTY_VM_ENGINE`). The real realm closes the ADR-0138 direct-`eval` leak by construction (its premise — the browser gives no synchronous isolated realm — is FALSIFIED by `quickjs-emscripten` release-sync after a one-time async preload joined to worker boot). `runInThisContext` stays host-realm `(0,eval)` (it IS the worker realm — Node-correct). Cost: ~503 KB `.wasm` + new deps + ~6× eval + per-property membrane crossing — the rewrite opt-in is the perf / V8-semantics escape hatch.

## Context

`node:vm` is a compatibility property bag, NOT a security sandbox (`docs/public/compat/modules.md`).

### Grafted from ADR-0138 — the host-realm design + why eval leaked

The original engine executed context code in the HOST realm:
`new Function('ctx','src','helper','with (ctx) { return eval(src) }')`, where `src`
is the user code after an acorn AST rewrite that redirects writes to undeclared names
onto the context object (`helper.x = …`). The write-leak class was closed for ordinary
syntax (assignments incl. compound/update/logical/destructuring, `var`/function
declarations, for-in/of targets, `delete`) and the M11 close of `vm-sandbox-residual-gaps`
(removed on close — git history) added function hoisting, declaration-statement
completion values, statement-position `var` destructuring, and post-run persistence of
context `var` bindings.

One gap was STRUCTURALLY unfixable in that design: a **direct `eval(...)`** inside vm
code. The rewrite operates on the OUTER source acorn can see; the string passed to a
nested `eval` is opaque at rewrite time and runs under the engine's own (host-realm)
direct-eval semantics. So `vm.runInNewContext('eval("leaked = 1")', sandbox)` wrote
`leaked` to the HOST global, where real Node — a genuinely separate realm — writes it
to the sandbox. ADR-0138 considered: (1) re-rewrite the eval argument — only helps a
string literal, dynamic `eval(buildSrc())` stays opaque and nested-eval scope semantics
can't be reproduced by re-feeding a string; (2) realm-level execution — "needs an
isolated realm primitive (ShadowRealm/iframe/Worker global) the browser does not give
synchronously"; (3) accept + document. 0138 chose (3): `eval` stays in `HELPER_BINDINGS`
so the `with` proxy reports it absent and the rewritten code resolves the real host
`eval`; the leak is documented loudly rather than half-intercepted. Read-side
fall-through to host globals was likewise BY DESIGN (compat property bag, not isolation).

### What changed — 0138 option 2 is now feasible

The substrate research (6-substrate workflow, adversarially verified + empirically
probed — backlog `vm-quickjs-realm-engine`) found **QuickJS-WASM**
(`quickjs-emscripten`, `*-release-sync` variant) is the only substrate that is a real
realm AND synchronous AND runnable in a Worker (no `document` — D-003, rules out
iframe) AND able to share a live host object (via a membrane). After a ONE-TIME async
`getQuickJS()` preload, all ops are SYNCHRONOUS. Empirically: `eval("leaked=1")` stays
in the guest, `"use strict"; undeclaredX=1` → `ReferenceError`, redeclared intrinsics
are no-ops, `document` is `undefined`, no SAB needed. This **falsifies ADR-0138's
premise** that the browser gives no synchronous isolated realm. The whole rewrite
fragility CLASS (statement-level text rewrite, name-vs-intrinsic registration, no real
realm) dissolves in a real realm. Adoption is IRREVERSIBLE on three counts (new dep +
~503 KB `.wasm` public dependency-graph change; supersedes the active ADR-0138;
threat-model shift) → this decision record.

## Decision

**Dual-engine. NOT two equal modes — correctness is the default, the rewrite is a loud
escape hatch.** The work is implemented (T1–T19); this ratifies it.

1. **Dual-engine policy.** The QuickJS-WASM real realm is the DEFAULT for the sandbox
   APIs. The hardened AST-rewrite is a LOUD opt-in: `RuntimeOptions.vmEngine`
   (host/sandbox-level — a per-call Node-API option can't reach the usually-TRANSITIVE
   vm consumer) with an `__RIFTY_VM_ENGINE` env/global fallback (precedence: explicit >
   env > global > default). When the opt-in resolves, the engine emits ONE stderr
   `[rifty]` warning per process AND records `vm.engine.rewrite-active` divergence
   telemetry. The opt-in does NOT carry the rewrite's old root-#1/#2 bugs (those are
   fixed in the rewrite regardless) — it diverges only on the structurally V8-leaning
   residuals below.

2. **Corrected routing.** `runInThisContext` stays HOST-realm `(0,eval)` — it IS the
   worker realm, already Node-correct (including nested eval). QuickJS handles ONLY the
   sandbox APIs: `runInNewContext` / `runInContext` / `Script.runInNewContext` /
   `Script.runInContext`. Splitting by API shape, not by a global switch.

3. **eval interception — the ADR-0138 gap is CLOSED.** Direct `eval(...)` inside vm
   context code is now ISOLATED in the real realm (`typeof globalThis.leaked ===
   'undefined'` after `runInNewContext('eval("leaked=1")')`). No partial string-literal
   interception, no host leak — the genuine realm boundary handles it for free.

4. **The membrane** (bidirectional; `vm/membrane.ts`, one per `QuickJSContext`). QuickJS
   handles are WASM-heap, not host objects — nothing crosses live by reference, so live
   `contextObject` sharing needs a real Proxy membrane:
   - identity cache via an UNFORGEABLE, guest-UNREACHABLE id registry (an
     unreachable-closure `WeakMap` retained host-side, never exposed on the guest global
     — guest code cannot forge a host-origin id and exfiltrate a real host reference);
   - cross-realm exotic mirroring (Array/Date/RegExp/TypedArray/Error/Symbol) so brand
     checks (`Array.isArray`, `Object.prototype.toString`) and prototype-chain methods
     work both directions while `instanceof <hostCtor>` stays FALSE;
   - lifetime via FinalizationRegistry + refcount — a leaked guest handle ABORTS the
     WASM runtime, so the context is disposed ONLY when pending AND no wrapper-backed
     handle is live (a refcount, not finalizer ordering);
   - sync post-run reconciliation = reseed-before (host→guest, picks up between-run host
     mutations) + sweep-in-`finally`-after (guest→host, on success AND throw). vm runs
     are SYNCHRONOUS, so reseed+sweep is OBSERVATIONALLY EQUIVALENT to a live
     contextObject for synchronous runs (the host can't observe the sandbox mid-run).
   - Caveats: a guest CALLBACK mutating the sandbox AFTER the synchronous run is seen
     only at the next reconciliation; structurally REMOVING a key from a nested host
     object between runs is not reflected (overwrite/add only).

5. **Behavior change (Node-correct).** Cross-realm identity is now Node-correct:
   `runInNewContext('[]') instanceof hostArray === false` (the old rewrite WRONGLY gave
   `true`), while `Array.isArray` is TRUE and `.name`/`.constructor.name` stay faithful;
   a fresh context no longer inherits host globals (the rewrite's `with(proxy)` leaked
   them). This closes `vm-context-global-object-fidelity` (real global-object attribute /
   lexical / strict semantics by construction). It is a BEHAVIOR change vs the old
   rewrite — recorded here, pinned by parity + conformance.

6. **Threat model restatement.** A real realm INCIDENTALLY becomes an isolation boundary
   (direct eval no longer leaks; a fresh context has no host globals). The framing is
   UNCHANGED: `node:vm` is a compatibility property bag, NOT a security sandbox. We do
   not claim, test, or maintain `vm` as a security boundary; the membrane exists for
   compat fidelity, not confinement.

7. **Accepted residuals (ES2023 ≠ V8).** QuickJS is ~ES2023, not V8. Four documented
   divergences remain on the default engine (each verified vs real Node, pinned by
   conformance + parity; the rewrite opt-in is the V8-correct floor for these):
   1. `function undefined(){}` redeclaration error TYPE — V8 early `SyntaxError`,
      QuickJS spec-literal runtime `TypeError`;
   2. explicit `var x = undefined` initializer not propagated to the sandbox (post-run
      sweep can't distinguish it from declaration-only `var x;`);
   3. sandbox key ENUMERATION order (V8 contextify setter order vs QuickJS guest
      creation order — `Object.keys` order of a sandbox is V8-internal, not spec);
   4. `delete` of a context `var`/function — a real-realm non-configurable global
      binding makes `delete v` a no-op (V8 contextify reports it gone).
   Canonical list: `docs/public/compat/modules.md` (node:vm section).

8. **The cost.** New deps `@jitl/quickjs-wasmfile-release-sync` +
   `quickjs-emscripten-core`; ~503 KB `.wasm` (env-config URL per D-004 — never
   hardcoded); ~6× eval vs native + per-property membrane crossing (~1.3 µs). The
   `rewrite` opt-in is the perf / native-V8-semantics escape hatch (native V8, no WASM
   bundle, no membrane), justified beyond speed by the V8 hedge and a dev cross-check
   mode (run both, warn on divergence).

Links M11.

## Consequences

- The rewrite fragility CLASS (any new statement-semantics or global-object shape) is
  gone for the default path — real intrinsics / strict mode / lexical scope / real
  global by construction.
- Direct `eval`, real global-object semantics, cross-realm identity now Node-correct;
  closes `vm-quickjs-realm-engine` + `vm-context-global-object-fidelity`.
- Behavior change: cross-realm `instanceof` against a host ctor is now FALSE (Node-correct,
  was wrongly TRUE) — a consumer relying on the old leak breaks; the `rewrite` opt-in
  restores host-realm identity.
- Cost: ~503 KB `.wasm` + two new deps in the public dependency graph; WASM-interpreter
  eval + membrane crossing on the sandbox path — `vm` must not sit on a hot loop
  (module loader / per-file test harness) without the opt-in.
- Four ES2023≠V8 residuals stand as documented divergences (not faked); the rewrite
  opt-in is the V8-correct floor.
- The rewrite engine is KEPT (do NOT delete it) — the cutover stays low-risk; the floor
  never goes away.
- Disposal discipline is load-bearing: a leaked guest handle aborts the runtime — guarded
  by FinalizationRegistry + refcount and a disposal/lifetime stress suite.

## References

- `docs/public/compat/modules.md` — engines + the canonical ES2023≠V8 divergence list.
- `packages/runtime-js/src/builtins/vm/` — `index.ts` (dispatcher + routing),
  `quickjs-engine.ts`, `membrane.ts`, `rewrite-engine.ts` (opt-in floor), `engine-config.ts`,
  `quickjs-loader.ts` (env-config `.wasm` URL + one-time preload).
- `tools/node-parity-runner/cases/vm/`, `tests/conformance/builtins/vm.test.ts` — parity +
  conformance corpus (real-world usage, cross-realm identity, residual divergences).
- Backlog (closed by this ADR, removed — git history): `vm-quickjs-realm-engine` (spec),
  `vm-context-global-object-fidelity` (closed by the real realm).
