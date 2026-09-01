---
area: runtime-js
status: ready
title: bounded NotImplementedError cause projection through the toolchain error seam
created: 2026-09-01
epic: no-coi-sandbox-tier
why: the generic toolchain error path preserves a real named product gap hidden by an ordinary Error wrapper, but its declared eight-link walk reads a ninth cause getter at depth eight; an adversarial getter throws instead of returning the honest outer error
user_story: As a package author whose installed bin wraps a rifty NotImplementedError in an ordinary loader Error, I want the existing toolchain result to preserve that named gap within a strict finite bound, while arbitrary, cyclic or hostile cause chains remain the original loud outer failure
sources: [ADR-0375, docs/process/fault-classes.md]
code: [packages/workbench/src/workers/declared-gap-cause.ts, packages/workbench/src/workers/declared-gap-cause.test.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop`. Its Final verify
closed the callable-WebIDL blocker, then found one new `observable-order`
blocker: `declaredGapCause` promises at most eight `Error.cause` links but reads
`cause` again after inspecting an ordinary Error at depth eight. The executed
probe threw `ninth cause read` with one ninth-getter invocation.

The product seam already exists:
`runInstalledBin` catches a package failure, projects a real
`NotImplementedError` through `declaredGapCause`, then `serializedError` sends
the selected error over the toolchain result protocol. This child owns only
that bounded package-generic projection. It adds no error protocol or lifecycle
authority.

## Predecessor clause (verbatim)

Predecessor: `distribution/no-coi-sandbox-build-loop`. Checkpoint lineage and
attempt counts carry into this split successor.

> 5. A dependency may wrap the named gap in its own loader error. Run-bin error
> projection walks at most eight `Error.cause` links and surfaces the first
> real `NotImplementedError`; cycles/deeper chains remain the outer loud error.
> This is bounded error provenance, not retry/recovery state.

## Challenge

challenge: 2026-09-01 — clear

## User scenario

An arbitrary installed package bin reaches a real rifty
`NotImplementedError('package.feature')`, catches it, and throws an ordinary
loader Error whose `cause` chain contains that gap. The existing toolchain
Worker returns the inner real gap's name, message and feature when it is within
eight links. A package-controlled ninth getter, cycle, non-Error tail or
throwing getter cannot hang or replace the honest outer loader Error.

## Reference contract

- ADR-0375 Decision 5 is the exact authority: at most eight `Error.cause`
  links, first real `NotImplementedError` within the bound, outer loud Error for
  cycles/deeper chains, no retry/recovery state.
- Existing observable seam:
  `no-coi-toolchain-worker.ts` `runInstalledBin` → `declaredGapCause` →
  `serializedError` → toolchain result. No new public API or wire field is
  needed.
- Final verify artifact at `6f86d2e7f`: depth-eight ordinary Error with a
  throwing ninth `cause` getter produced
  `{threw:true, reads:1, message:"ninth cause read"}`. Correct RED requires the
  getter counter to remain zero and the honest outer Error to serialize.

## Acceptance

1. The existing toolchain error serialization path surfaces the first real
   `NotImplementedError` at depth zero through eight of an ordinary
   `Error.cause` chain, preserving its exact name, message and feature. A plain
   Error that only copies those fields is not promoted.
2. Projection inspects at most eight cause links. After inspecting an ordinary
   Error at depth eight it does not invoke or read that Error's `cause` getter.
   An executed depth-eight carrier installs a throwing ninth getter and proves
   zero getter calls plus serialization of the exact outer Error.
3. Cycles, a non-Error cause, a deeper real gap and any cause getter that throws
   terminate with the honest original outer Error. They never hang, surface the
   getter failure, or claim the deeper gap.
4. Ordinary errors without a bounded real gap retain the existing serialized
   name/message/code/path/feature behavior. Direct and bounded named gaps keep
   their current behavior through focused runtime, Worker and real-Chromium
   package-generic carriers.
5. The mechanism is Vite-free and package-generic: one bounded projection at
   the existing serialization seam, no new public API, dependency, queue,
   owner, retry, recovery state or protocol field.

## Parity cases

1. Generic bounded gap: an arbitrary `package.feature`
   `NotImplementedError`, direct and behind one/eight ordinary wrappers,
   surfaces by identity before serialization and by exact name/message/feature
   through the Worker. Existing direct/eight-link unit cases are preservation
   controls; a package-generic real-Chromium installed-bin case closes the
   observable seam.
2. Exact bound RED: eight ordinary links end in an ordinary Error whose own
   `cause` accessor increments then throws. The accessor is the forbidden ninth
   read; the executed test asserts zero reads and the exact outer Error. Current
   implementation throws `ninth cause read` after one read.
3. Honest termination: self/two-node cycles, non-Error tails, depth-nine real
   gaps and throwing getters return no projection, so the existing serializer
   emits the original outer Error. The carrier proves termination and error
   identity, not only absence of a named gap.
4. False identity control: an Error with
   `name:'NotImplementedError'`/`feature:'package.feature'` but no real class
   identity remains the outer ordinary error; package names and bin paths never
   affect projection.

## Evidence

RED-UNIT, source HEAD `9654060844dee4139be6c6f2c4e0f940bd3ae5f3`,
Node 24.16.0, pnpm 11.5.2, Vitest 2.1.9:

```sh
pnpm exec vitest run --project unit \
  packages/workbench/src/workers/declared-gap-cause.test.ts --reporter=verbose
# Tests 2 failed | 2 passed (4)
# exact bound received:
# { reads:1, projected:undefined,
#   thrown:{ name:'Error', message:'forbidden ninth cause read 1' } }
# expected: { reads:0, projected:null, thrown:null }
# hostile getter received:
# { reads:1, projected:undefined,
#   thrown:{ name:'Error', message:'hostile cause read 1' } }
# expected: { reads:1, projected:null, thrown:null }
```

The passing controls execute direct/eight-link real gaps, depth-nine gap,
ordinary/non-Error tails, forged identity, self-cycle and two-node cycle. The
two REDs fail only on the missing bounded/getter-failure behavior.

RED-BROWSER, Playwright 1.60.0, Chrome 148.0.7778.96:

```sh
pnpm test:no-coi -g "package-generic bounded cause projection"
# boundedGap: NotImplementedError / exact toolchain.threaded-wasm message + feature
# exactBound received: Error / "forbidden ninth cause read 1" / no code,path,feature
# expected: PackageLoaderError / "ordinary package loader failure" /
# ERR_PACKAGE_LOADER / exact package path / package.loader
# 1 failed
```

The browser carrier writes an ordinary package-generic `.bin` launcher and
entry into the real VFS, then observes the existing no-COI toolchain Worker
result through SDK deserialization. It uses no Vite package or Vite identity.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `observable-order` × depth-eight cause projection | inspect the depth-eight Error but never read its ninth getter; serialize the original outer Error | Acceptance/Parity 2/2; executed zero-call ninth-getter RED |
| `unbounded-read` × cyclic/deep cause chain | hard eight-link ceiling terminates without cycle storage; cycles/deeper gaps keep outer Error | Acceptance/Parity 3/3; self/two-node/depth-nine cases |
| `false-fallback` + `provenance-lie` × named-gap selection | first real in-bound `NotImplementedError` surfaces; forged identity, non-Error and getter failure never become a named gap | Acceptance/Parity 1, 3-4/1, 3-4; focused runtime/Worker/browser carriers |

## Out of scope

- No Vite, Rolldown, package-name, version, bin-path or argv policy/fixture.
- No recursive public error serializer, wire-shape change, AggregateError walk,
  arbitrary object traversal or string/name-based NotImplementedError match.
- No change to the eight-link ADR bound, shared-memory boundary, install/bin
  control plane, capability report, build parity or dev/HMR lifecycle.
- No dependency, public API, retry, recovery, queue, heartbeat, journal, cache,
  lock, cycle registry or persistent state.

## Decisions

review: checkpoints — runtime error fidelity on an existing Worker/browser
serialization seam.

predecessor: `distribution/no-coi-sandbox-build-loop`

Copied predecessor checkpoint lineage (verbatim); the fresh child
Contract+RED verdict follows outside PICKUP:

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
- User-authorized SPLIT narrows only the next frontier unit. Build-loop and the
  frozen goal behavior stay unchanged; this child owns only ADR-0375 Decision
  5's generic bounded projection.
