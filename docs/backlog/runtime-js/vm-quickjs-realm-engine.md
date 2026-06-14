---
area: runtime-js
status: parked
title: node:vm real-realm engine (QuickJS-WASM) + dual-engine policy — eliminate the rewrite fragility class
created: 2026-06-14
why: the host-realm with(proxy)+eval+AST-rewrite has three STRUCTURAL fragility roots; a real realm removes the whole class. Research (6-substrate workflow + empirical probes) found QuickJS-WASM the only viable substrate. Adoption supersedes ADR-0138 (eval-permanent), so it gets its own decision — this is the spec.
user_story: As a dev running real-world npm code that uses node:vm (config loaders, template engines, test runners), I want full Node fidelity including direct `eval` and real global-object semantics; currently the host-realm AST-rewrite cannot provide them and keeps generating divergences in new syntactic/intrinsic shapes.
sources: [M11, "PR #30 review", "vm-substrate-alternatives research workflow", ADR-0138, vm-context-global-object-fidelity]
code:
  [
    packages/runtime-js/src/builtins/vm.ts,
    tests/conformance/builtins/vm.test.ts,
    tools/node-parity-runner/cases/vm/,
  ]
---

## Context

`node:vm` runs context code in the HOST realm via `with(proxy) + eval(rewritten)`
over an acorn AST-rewrite. Three STRUCTURAL fragility roots (not bugs — design
limits) keep generating divergences:

1. **statement-level text rewrite** — neutralising a `var` statement's completion
   value needs a `{ let T = (…); }` block, which is grammar-context-sensitive (broke
   unbraced if/else/do-while bodies — PR #30 fix).
2. **name-vs-intrinsic registration** — redirecting writes by name collides with
   intrinsics (`var Map;` shadowed the real Map — PR #30 fix).
3. **no real realm** — direct `eval` leaks to the host (ADR-0138, permanent); no
   real global-object fidelity (property attributes, non-configurable `delete`,
   lexical-intrinsic redeclaration, `"use strict"` undeclared-write `ReferenceError`,
   cross-run `let`/`const` persistence — parked in `vm-context-global-object-fidelity`).

Roots #1/#2 are patchable; the CLASS (any new statement-semantics or global-object
shape) recurs. Root #3 is unreachable in this design. A **real separate realm**
removes all three by construction.

## Research result (6-substrate workflow, adversarially verified + empirically probed)

A real realm needs to be (a) synchronous (the vm API is sync), (b) able to share a
LIVE host `contextObject` (sandbox mutates it, host reads back, seeded with host
functions), (c) Chrome/Edge-2026 available, (d) runnable where `runtime-js` lives —
**inside Workers, which have NO `document`** (D-003).

| substrate | verdict | why |
|---|---|---|
| **QuickJS-WASM** (`quickjs-emscripten` *-release-sync*) | **WINNER** | only one that is real-realm AND sync AND in-Worker (no DOM/SAB/COOP) AND can share a live object (via membrane) |
| same-origin iframe | partial | real sync realm + same-thread live sharing, BUT `runtime-js` runs in Workers → no `document` → cannot create an iframe (layer misfit) |
| harden rewrite | floor | native live sharing for free, but CANNOT eliminate the class (root #3 unreachable) |
| SES Compartment | partial | rejects direct eval, forces strict, `globals` is a snapshot — worse contextify than today |
| Worker + SAB | refuted | thread boundary → structuredClone drops functions/getters/prototype/identity; live sharing impossible |
| ShadowRealm | refuted | not shipped (flag-gated, Stage 2.7); marshals primitives+callables only — cannot pass a live object |

**Empirically confirmed** (`quickjs-emscripten` in Node, sync variant): after a
one-time async `getQuickJS()` preload, all ops are SYNC; `if(false)var x=1;else 2;`
⇒ 2, `var Map; new Map()...` ⇒ works, `eval("leaked=1")` stays in the guest (host
`globalThis.leaked` undefined), `"use strict"; undeclaredX=1` ⇒ `ReferenceError`;
`document` is `undefined`, no SAB needed. **This falsifies ADR-0138's premise** that
"realm-level execution needs an isolated realm primitive the browser does not give
synchronously."

## Decision posture: DUAL-ENGINE, not a replacement

Keep BOTH engines. NOT two equal modes — **correctness is the default; speed is a
loud, documented opt-in**:

- **Default = QuickJS real realm.** Full Node fidelity: all 3 roots gone, direct
  eval works, real global-object semantics. Closes `vm-context-global-object-fidelity`.
- **Opt-in = hardened rewrite** (host realm, native V8). Justified beyond speed:
  - **Speed** — native V8 vs a WASM bytecode interpreter (no JIT): 10–100× on
    compute; no per-property membrane crossing.
  - **Bundle** — no ~503 KB `.wasm` for consumers that don't need realm fidelity.
  - **V8 hedge** — QuickJS is ~ES2023, not V8; rewrite is the native-semantics
    fallback.
  - **Cross-check** — a dev mode can run BOTH and warn on divergence (parity-as-tool).
- **Risk:** the opt-in changes correctness silently, and the vm consumer is usually
  a TRANSITIVE dep → the toggle must be a **host/sandbox-level config** (a Node-API
  per-call option won't reach transitive callers), **loud** (telemetry when active,
  cf. `playground/notimplemented-stub-telemetry`), and ship with the exact
  divergence list. The opt-in must NOT carry the known root-#1/#2 bugs (those are
  fixed in the rewrite regardless) — it diverges only on the structurally-unreachable
  root-#3 set.

### Hybrid routing (composes with the toggle)
Split by API shape on whether a live host object is shared:
- `runInNewContext` / `runInThisContext` / `Script` (no live back-channel) → real
  realm immediately. Fidelity is a strict gain AND the cross-realm identity change is
  Node-CORRECT (Node's `runInNewContext('Array') !== host Array`; today's rewrite
  WRONGLY gives `[] instanceof host Array === true`). Membrane barely engaged.
- `runInContext(code, liveHostObject)` → the membrane is expensive here; keep the
  hardened rewrite until the membrane passes the full live-object parity sweep.

## Membrane (the migration cost for live-object sharing)

QuickJS handles are WASM-heap, not host objects — nothing crosses live by reference.
Live `contextObject` sharing needs a real Proxy **membrane**:
- per-context WeakMap identity cache (host-obj ↔ guest handle) to restore `===`,
  `Object.keys`, `in`;
- `get/set/has/ownKeys/getOwnPropertyDescriptor/deleteProperty` traps proxying to
  the host object; host-accessor `defineProperty` for flat globals;
- post-run `getOwnPropertyNames` sweep to reconcile guest-invented globals (Node's
  live proxy catches these for free);
- explicit `Array`/`Date`/`RegExp`/TypedArray exotic mirroring (`Array.isArray` over
  a plain Proxy stays FALSE);
- strict handle-disposal discipline — **a leaked handle ABORTS the runtime**.

Proven-by-construction in research (a working bridge was built); it is the dominant
cost, not a footnote.

## Options or Next (migration phases)

- **Phase 0 — DONE (PR #30).** Hardened the rewrite (the two root-#1/#2 fixes) with
  parity + conformance cases. The rewrite is the safety floor and the opt-in engine.
- **Phase 1 — spike (flag, IRREVERSIBLE → needs the ADR first).** Add
  `quickjs-emscripten` (release-sync) as a `runtime-js` leaf dep; wire the one-time
  `getQuickJS()` preload into Worker boot before any `vm.*`; implement
  `runInNewContext`/`runInThisContext`/`Script` on a `QuickJSContext`. Re-run the vm
  parity+conformance sweep against the real realm; update cross-realm-identity
  expectations to Node-correct (this is MORE faithful, not a regression).
- **Phase 2 — membrane.** Build live-object sharing for `runInContext(liveObject)`;
  gate behind live-object parity cases (deep mutation, `===`, `Object.keys`, `in`,
  host-fn callbacks both directions, exotic `isArray`).
- **Phase 3 — cutover.** Default to QuickJS; keep the rewrite as the opt-in engine
  (do NOT delete it). Close `vm-context-global-object-fidelity`. Supersede ADR-0138.
- **Sequencing rule:** never demote the rewrite below "shippable opt-in" until the
  membrane passes the full live-object sweep.

### Decision gate (before Phase 1)
Adoption is IRREVERSIBLE on three counts → **superseding ADR via a decision
subagent** (overturns the active ADR-0138, which is then removed + pointer in
`docs/adr/README.md`):
1. new dep + ~503 KB `.wasm` (public dependency-graph change);
2. contradicts/supersedes ADR-0138 (its rejected "option 2" is now feasible);
3. threat-model shift — a real realm incidentally becomes an isolation boundary,
   so restate the "compat property bag, NOT a security sandbox" framing; and
   cross-realm identity changes (Node-correct, but a behavior change).
The ADR should ratify the dual-engine policy + the API-shape routing + the membrane
caveats, and link the milestone.

## Open questions

- Do real consumers pass a live host **Array/Date/Map** into a context and rely on
  brand checks? (decides whether exotic-mirroring is Phase-2-mandatory or deferrable)
- Disposal robustness under long-lived `createContext` + many runs (a leaked handle
  aborts the runtime) — needs a stress test / FinalizationRegistry safety net.
- Where in Worker boot does the async `getQuickJS()` preload land vs the first
  `vm.*` call (a top-level sync `vm.*` before preload throws)?
- QuickJS ~ES2023 vs V8 — which parity cases diverge; budget for triage.
- Routing predicate precision: how to detect "live host functions present" for the
  `runInContext` vs `runInNewContext` split (VM_CONTEXT marker? caller opt-in?).
- Bundle/latency budget: ~503 KB `.wasm` + ~6× eval + ~1.3 µs/property-crossing —
  is `vm` ever on a hot path (module loader / test harness running vm per file)?

## Reversibility

Phase 0 was REVERSIBLE (CHANGELOG). Phases 1–3 are IRREVERSIBLE (new dep, supersedes
an active ADR, threat-model shift) → gated on the superseding ADR. Keeping the
rewrite as the opt-in engine keeps the cutover itself low-risk (the floor never goes
away).
