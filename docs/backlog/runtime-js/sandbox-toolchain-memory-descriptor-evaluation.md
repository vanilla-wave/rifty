---
area: runtime-js
status: ready
title: sandbox toolchain WebAssembly.Memory descriptor evaluation parity
created: 2026-09-02
epic: no-coi-sandbox-tier
why: the no-COI realm guard reads descriptor.shared before native construction and the native constructor reads it again; a stateful false-then-true getter therefore creates shared memory where native Node and Chrome read once and create non-shared memory
user_story: As a package author whose WebAssembly.Memory descriptor uses observable accessors, I want the sandbox toolchain realm to preserve native evaluation count and order while rejecting an actual shared-memory request by name, but today a stateful getter can turn a non-shared request into SharedArrayBuffer
sources: [ADR-0375, docs/process/fault-classes.md, distribution/no-coi-sandbox-build-loop]
code: [packages/runtime-js/src/internal/sandbox-toolchain-realm.ts, packages/runtime-js/src/internal/sandbox-toolchain-realm.test.ts, packages/runtime-js/src/worker-entry.ts, packages/runtime-js/src/module-loader/loader.ts, tests/no-coi/no-coi-memory-descriptor.spec.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop`. Its binding
Final continuation found one `observable-order` / `false-fallback` blocker.
Native Node 24.16.0 and Chrome 148 evaluate a `WebAssembly.Memory` descriptor
as `initial` → `maximum` → `shared`, once each. The real headerless public-SDK
Worker evaluates `shared` → `initial` → `maximum` → `shared`: the realm guard
pre-reads `shared`, then the native constructor reads the descriptor again.

With a stateful `shared` getter returning `false` then `true`, native evaluation
reads only `false` and constructs non-shared memory. The current no-COI guard
accepts the first `false`, the native reread observes `true`, and the result is
backed by `SharedArrayBuffer`. This defeats the generic shared-memory boundary.

The existing runtime-js seam is
`sandboxToolchainWebAssembly()` in
`packages/runtime-js/src/internal/sandbox-toolchain-realm.ts`. It supplies the
lexical `WebAssembly` binding already consumed by REPL and the CJS/ESM module
loader. This child owns only descriptor evaluation at that seam; package and
bin identity are irrelevant.

## Predecessor clause (verbatim)

Predecessor: `distribution/no-coi-sandbox-build-loop`. Checkpoint lineage and
attempt counts carry into this split successor.

> The toolchain realm supplies a lexical `WebAssembly` binding. Its `Memory`
> proxy performs WebIDL ToBoolean on `descriptor.shared` and throws
> `NotImplementedError('toolchain.threaded-wasm')` before native construction.
> The Worker-global constructor and non-shared constructor/prototype identity
> stay native; no permanent global wrapper exists.

## Challenge

challenge: 2026-09-02 — 1 problems
1. Impact/user experience is overstated: evidence covers accessor-backed descriptors, chiefly a synthetic false-then-true `shared` getter, while `user_story` claims benefit for any package constructing `WebAssembly.Memory`; no real package flow or material share of the user-visible no-COI gap is evidenced.

Disposition: claim narrowed to packages with observable descriptor accessors;
the child claims correctness of the frozen generic shared-memory boundary, not
adopter share. The package-generic installed-bin sibling proves reach, not
prevalence. No additional goal or outside-goal residual follows.

## User scenario

An arbitrary package uses REPL, CJS, ESM or its installed bin to construct
`WebAssembly.Memory` with accessor-backed `initial`, `maximum` and `shared`.
The sandbox realm observes the same property order and one-read cardinality as
native Node/Chrome. A `shared` getter returning `false` then `true` is consumed
once as false and produces native non-shared memory; a first-read truthy value
still reaches the existing named `toolchain.threaded-wasm` boundary. No package
name, Vite fixture or lifecycle policy participates.

## Reference contract

- Native oracles recorded by the predecessor Final review: Node 24.16.0 and
  Chrome 148.0.7778.96 both read `initial` → `maximum` → `shared`, once each.
- Current product observation at `01465c6ae`: the real headerless public-SDK
  Worker reads `shared` → `initial` → `maximum` → `shared`; a false-then-true
  `shared` getter creates `SharedArrayBuffer` instead of native non-shared
  memory. This is the required same-realm differential RED target at pickup.
- ADR-0375 Decision 4 fixes the intended divergence: preserve native
  descriptor evaluation, but replace an actual shared request with
  `NotImplementedError('toolchain.threaded-wasm')` before shared construction.
- Existing observable seam: runtime-js `sandboxToolchainWebAssembly()` → REPL
  lexical binding and module-loader lexical binding → CJS/ESM/installed-bin
  execution. No new public or protocol seam is needed.

## Pickup evidence

Evidence N24-ORACLE (Vitest 2.1.9, Node v24.16.0):

```sh
pnpm exec vitest run --project unit \
  packages/runtime-js/src/internal/sandbox-toolchain-realm.test.ts \
  -t "records the native Node v24.16.0" --reporter=dot
# 1 passed, 4 skipped. Exact result: initial,maximum,shared; one shared read;
# false→true returns [object ArrayBuffer].
```

Evidence C148-ORACLE (Playwright 1.60.0, Chrome 148.0.7778.96):

```sh
pnpm exec playwright test --config playwright.no-coi.config.ts \
  --project=chromium tests/no-coi/no-coi-memory-descriptor.spec.ts \
  -g "headerless Chrome 148 native"
# 1 passed. Response has no COOP/COEP; crossOriginIsolated=false;
# initial,maximum,shared once; false→true returns [object ArrayBuffer].
```

Evidence RED-REALM (Vitest 2.1.9, Node v24.16.0, current product
`53353de49`):

```sh
pnpm exec vitest run --project unit \
  packages/runtime-js/src/internal/sandbox-toolchain-realm.test.ts --reporter=dot
# EXPECTED RED: 3 failed, 2 passed. Guarded false reads
# shared,initial,maximum,shared twice; false→true returns SharedArrayBuffer;
# first-read truthy throws the right named gap after reading only shared.
```

Evidence RED-WORKER (Playwright 1.60.0, Chrome 148.0.7778.96, real headerless
public SDK Worker, current product `53353de49`):

```sh
pnpm exec playwright test --config playwright.no-coi.config.ts \
  --project=chromium tests/no-coi/no-coi-memory-descriptor.spec.ts \
  -g "public Worker REPL CJS ESM"
# EXPECTED RED: 1 failed. REPL, CJS, ESM and arbitrary installed bin all
# report shared,initial,maximum,shared; two reads; SharedArrayBuffer.
```

Evidence C148-PRESERVE (same browser/toolchain):

```sh
pnpm exec playwright test --config playwright.no-coi.config.ts \
  --project=chromium tests/no-coi/no-coi-sandbox-build-loop.spec.ts \
  -g "threaded-WASM guard covers real installed bin"
# 1 passed. Literal/inherited/accessor/callable truthy controls keep the exact
# named gap; non-shared global/constructor/prototype identity stays native.
```

## Acceptance

1. A same-realm differential runs fresh accessor-backed descriptors through
   native `WebAssembly.Memory` and the existing runtime-js sandbox-toolchain
   realm seam. Both read `initial`, then `maximum`, then `shared`, exactly once;
   the guard never pre-reads or causes a native reread of caller properties.
2. A `shared` getter that returns `false` on its first call and `true` on any
   later call is invoked once. Native and guarded paths both construct
   non-shared memory backed by `ArrayBuffer`; the guarded result is never backed
   by `SharedArrayBuffer`.
3. A descriptor whose first and only `shared` value is WebIDL-truthy preserves
   the same `initial` → `maximum` → `shared` observation, then rejects with
   `NotImplementedError`, `feature==='toolchain.threaded-wasm'`, before shared
   memory exists. Literal/inherited/accessor/callable truthy controls and a
   normal non-shared descriptor keep their landed outcomes.
4. The count/order/stateful differential runs through each existing sibling:
   REPL, CJS, ESM and an arbitrary installed bin in the real headerless public-
   SDK Worker. All four agree with the same-realm carrier; none depends on Vite
   identity, version, path, argv or lifecycle.
5. The Worker-global `WebAssembly.Memory` remains native. Non-shared instance
   constructor/prototype identity remains native through the existing lexical
   realm seam.
6. The repair is Vite-free and package-generic at the existing runtime-js realm
   seam. It adds no public API, dependency, protocol field, queue, retry,
   recovery authority or persistent/coordination state.

## Parity cases

1. Evaluation order/cardinality: Node 24.16.0 and Chrome 148 native constructors
   vs the runtime-js realm seam, using separate fresh descriptors with getters
   that log `initial`, `maximum`, `shared`. Exact expected log is
   `initial,maximum,shared`; each count is one.
2. Stateful false fallback: fresh false-then-true `shared` accessors prove one
   read and an `ArrayBuffer`-backed result in both native and guarded paths.
   Current guarded behavior reads twice and returns shared memory.
3. Intended policy divergence: first-read truthy `shared` preserves native
   property evaluation up to that value, then produces the existing exact
   named gap rather than shared memory. Existing literal, inherited, accessor
   and callable descriptors remain preservation controls.
4. Sibling drift: the same count/order/stateful probe produces one result shape
   through REPL, CJS, ESM and a package-generic installed bin. The same-realm
   differential is the authority; the four Worker entries prove the realm seam
   reaches every guest path.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `observable-order` × Memory descriptor evaluation | `initial` → `maximum` → `shared`, one read each; no guard pre-read/native reread | N24-ORACLE + C148-ORACLE vs RED-REALM + RED-WORKER |
| `false-fallback` × stateful `shared` conversion | false-then-true getter is consumed once as false; result stays `ArrayBuffer`, never shared | N24-ORACLE + C148-ORACLE vs RED-REALM + RED-WORKER |
| `provenance-lie` × actual truthy shared request | exact named `toolchain.threaded-wasm` gap after native-order conversion; no shared-memory success | RED-REALM + RED-WORKER; C148-PRESERVE controls |
| `sibling-drift` × guest entry | REPL/CJS/ESM/installed-bin share the runtime-js realm semantics | RED-WORKER four-entry sweep |

## Out of scope

- No Vite, Rolldown, package-name, version, bin-path, argv, build-output or
  lifecycle policy/fixture.
- No new WebAssembly public facade, SDK option, runtime public export, Worker
  message, result field or protocol version.
- No dependency, queue, retry, recovery, reconnect, cache, lock, ledger,
  registry or persistent/coordination state.
- No change to capability-report shape, install/run-bin admission, bounded
  error projection, build parity, host lifecycle or dev/HMR.
- No general WebIDL layer for other WebAssembly constructors; this child owns
  only `WebAssembly.Memory` descriptor evaluation at the existing toolchain
  realm seam.

## Decisions

review: checkpoints — package-generic runtime fidelity at the existing
toolchain realm seam.

- Pickup band: 4–4 expected RED tests — three same-realm order/stateful/truthy
  cases plus one real headerless Worker four-sibling sweep; native Node/Chrome
  oracles and landed truthy/identity controls stay green.

predecessor: `distribution/no-coi-sandbox-build-loop`

- `ready-verdict: 2026-09-01 — Contract+RED @ ead27000f`
- `ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2`
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- `final-green: 2026-09-01 — blocker @ a909a38a9`
- Final review convergence: find 1 blocker, fresh tail 0 new blockers,
  adjudication HOLDS. Callable WebIDL object descriptors bypassed the realm
  guard; one in-place fix/proof batch follows.
- `final-green: 2026-09-01 — blocker @ 6f86d2e7f`
- Final verify: prior callable blocker closed; 1 new blocker, concerns 0.
  Convergence valve 1→1 stops this unit. Bounded cause projection reads a
  ninth `Error.cause` after its declared eight-link limit; actual getter probe
  threw `ninth cause read`. Fault class `observable-order`; missing RED is a
  depth-eight boundary with zero reads of the next getter. No fix started.
- User-authorized SPLIT moved bounded projection to
  `runtime-js/bounded-not-implemented-cause-projection`; it landed Final+GREEN
  at `40ded47585bd04c62b2407210d515ed4f1f65ae1` and remains predecessor lineage,
  not this child's scope.
- `ready-verdict: 2026-09-01 — Contract+RED @ df3cc811d`
- Fresh revalidation: 38/38 coverage; 0 blockers; unit residuals empty.
  Original bands/RED lineage carry; the certified child is outside scope;
  Final continuation not started.
- `final-green: 2026-09-02 — blocker @ 01465c6ae`
- Final continuation: `pnpm pr:check` PASS; no-COI Chromium 14/14 PASS;
  34/38 coverage pass and four weak rows all map to B1; one unit residual.
  Native Node v24.16.0 and Chrome 148 read descriptor
  initial→maximum→shared once. The real headerless public-SDK Worker reads
  shared→initial→maximum→shared; a stateful false→true `shared` getter
  creates SharedArrayBuffer while non-COI instead of native non-shared/named
  guard. Fault `observable-order`/`false-fallback`; missing RED is a same-realm
  differential for count/order/stateful getter, with sibling sweep across
  REPL/CJS/ESM/installed-bin.
- Convergence valve 1→1; no fix, RED, next review round, dev-HMR or rechart
  started.
- User-authorized SPLIT narrows only the next frontier unit. Build-loop and the
  frozen goal behavior stay unchanged; this child owns only package-generic
  `WebAssembly.Memory` descriptor evaluation at the existing runtime-js realm
  seam.
