---
area: playground
status: draft
title: Durable Vite 8 reopen invalidates the pre-policy package tree
created: 2026-07-28
why: ADR-0336 changes the exact Vite 8 manifest and snapshot identity, but the blocked predecessor never proved that reopening the same saved project rejects pre-policy install trust and tree bytes.
user_story: As a user reopening a saved Vite 8 project after the runtime-policy upgrade, I want the project to use the current visible manifest and proven WASI runtime, but a stale trusted package tree must never survive under the old identity.
blocked_by: [playground/vite8-durable-tree-replacement-proof]
sources: [ADR-0278, ADR-0329, ADR-0336, docs/backlog/playground/reference/vite8-durable-reopen-contract-red.md, docs/backlog/playground/reference/vite8-durable-reopen-cross-build-probe.md, docs/backlog/playground/reference/vite8-wasi-runtime-closure-contract-red.md]
code: [apps/playground/src/adapters/playground-app-runtime.ts, packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workbench/internal/playground-project-definition.ts, tests/e2e/vite8-durable-reopen-invalidation.spec.ts]
---

## Context

This unit is now a terminal blocked split predecessor. Its two Contract+RED
checkpoints proved that activation/open compensation and the cross-build
durable-byte carrier are independently reviewable. It receives no third
checkpoint.

`playground/project-activation-open-compensation` first owns the narrow App
runtime/UI repair plus its create/save/reset/delete sibling sweep. Then
`playground/vite8-durable-tree-replacement-proof` owns only the real old→current
browser fixture, exact tree replacement, Reset, and offline same-card proof.
The Acceptance and Parity text below is preserved as the allocation authority;
neither successor may weaken it.

Terminal predecessor
`docs/backlog/playground/reference/vite8-wasi-runtime-closure-contract-red.md`
blocked after its second Contract+RED because `pickStarter()` created a fresh
Scratch for the final transition. This serial successor owns the omitted
durable-project half of ADR-0336 Proof bullet 4 and its `poisoned-cache` row.

A same-origin Chromium probe ran the pre-policy application at `c0dc2286`, saved
Vite 8 as named project A, saved project B, then restarted the current
application at `55dbd6e7` in the same browser profile. The frozen fixture uses
`7177b9da`, whose three relevant inputs are byte-identical to `c0dc2286`.
Opening A correctly threw
`ProjectDefinitionMismatchError` before package acquisition: ADR-0278 includes
the exact normalized seed and snapshot id in definition identity, and permits
baseline replacement only through explicit `reset`.

The probe also exposed a separate real failure. App runtime closes B, commits
`catalog.activate(A)`, then opens A outside the mutation catch. The definition
mismatch therefore leaves the catalog pointing at A, B closed, and no live
session. Activation is the only involved reversible catalog-pointer mutation;
its existing serialized App operation must compensate to B before surfacing the
original A error. Tree mutations retain their existing recovery owners.

The cross-build proof freezes only the two changed application inputs and a
compact delta from the current snapshot to the old exact snapshot. Workbench,
catalog, OPFS, package acquisition, Reset, and runtime execution remain the real
product paths.

## User scenario

On one origin and browser profile, the prior release creates and saves a named
Vite 8 project A, including a user edit and its trusted pre-policy dependency
tree, then creates and saves a different project B and leaves B running. After
the application upgrades, the user:

1. clicks the same saved A card and sees the definition-mismatch failure while
   B remains the active running project;
2. opens A's existing row menu, first cancels and then confirms **Reset to
   starter**, accepting that every A edit is deleted;
3. opens reset A once online, switches to B, blocks snapshot and registry
   traffic, then reopens the same A card successfully offline.

## Acceptance

1. A CI-active Chromium fixture runs the prior-policy and current application
   serially on the same origin and BrowserContext. The prior side uses the real
   app with frozen `7177b9da` manifest-normalization and snapshot-identity inputs.
   Its compact snapshot delta reconstructs exact serialized id
   `sha256:2b1af80918c6485aa910abac93d8db80b173b93ad5eff3c295829cbdb218c582`
   from the current committed artifact and rejects either-base drift.
2. The prior application saves A and B through the public UI on required OPFS.
   A has the old visible manifest without the ADR-0336 alias, the old snapshot
   descriptor and definition identity, a durable v4 trust claim, a
   distinguishable user edit, and the pre-policy `postcss@8.5.23` tree. B is
   active and observably running before and after the server restart.
3. Clicking stale A on the current application throws
   `ProjectDefinitionMismatchError` before any snapshot, registry, install, or
   A-runtime effect. The same B catalog ref and a newly bound live B session are
   restored before the transition rejects and its error toast is reported.
   Existing activation semantics may publish an in-flight A catalog snapshot
   while the transition is busy; after rejection settles, no empty-session,
   `Choose project`, or A-pointing half-switch remains.
4. Cancelling A's Reset dialog changes no A bytes, catalog ref, live B session,
   or network counter. Confirming it uses the existing A card and durable id,
   visibly deletes the old user edit and whole old tree, and leaves B active
   until the user switches.
5. Reset A agrees across the current visible manifest alias
   `@napi-rs/wasm-runtime: npm:@napi-rs/wasm-runtime@1.1.6`, snapshot descriptor
   `sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da`,
   definition identity, v4 install claim, `postcss@8.5.24` lock/tree bytes, and
   the executed Rolldown binding/core/runtime tuple
   `1.0.3 / 1.10.0 / 1.10.0 / 1.1.6`.
6. After one online reset/open, B→the same A card reaches Vite build/preview
   while snapshot and registry routes are blocked and counted. Both counters
   remain zero; a fresh Starter or new project id fails this acceptance.
7. App-runtime fault tests prove target-open rejection restores the prior
   catalog/session; catalog-restore and prior-reopen failures preserve target
   error first in `AggregateError`; a queued runtime close runs only after
   compensation and drains the restored session plus Workbench. If App rebinding
   of that restored context also fails, the reported aggregate preserves the
   target-open failure first and binding failure second.

## Reference contract

- Temporal product oracle:
  `docs/backlog/playground/reference/vite8-durable-reopen-cross-build-probe.md`.
- Prior-policy application input: `7177b9da`.
- Current-policy application input: `55dbd6e7`; merged repair:
  `23948c3dd54989eaa5c01543fa92e8d717d94f19`.
- Browser/toolchain: Chrome for Testing 148.0.7778.96, Playwright 1.60.0,
  Node 24.16.0.
- Current manifest/closure oracle:
  `docs/backlog/playground/reference/vite8-wasi-runtime-closure-probe.md`.

## Parity cases

This is an own-product temporal/storage contract; no Node API behavior is
claimed.

1. Same-origin old A→current A rejects before acquisition while current B stays
   active and live.
2. Reset Cancel is a no-op; confirmed Reset is the only baseline-replacement
   path and retains A's card/id while deleting its edits.
3. Current A opens online once, then same-card B→A reopens offline with exact
   current provenance and executable Vite/Rolldown behavior.
4. Target-open, compensation-mutation, compensation-open, and queued-close
   fault order matches Acceptance 7.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome |
|---|---|---|
| `poisoned-cache` × stale A open | Old definition, snapshot id, trusted claim, and tree survive the upgrade | Definition mismatch rejects before acquisition/runtime; no old byte executes. |
| `torn-state` × activate/open | A catalog activation commits, then A definition open rejects | Existing App operation reactivates and reopens B before surfacing A's error. |
| `torn-state` / `quota-perm-fail` × compensation | B reactivation or reopen rejects | Loud `AggregateError` preserves A failure first and exact restore failure second; runtime never claims a live session. |
| `observable-order` × activate/close | Runtime close queues while A rejection/compensation is in flight | Compensation settles first; close then drains restored B and the sole Workbench owner. |
| `observable-order` × App rebind | Runtime restores B but UI binding rejects | Report `[A open failure, B bind failure]` in causal order; never replace the invalidation cause. |
| `provenance-lie` × Reset | Old claim/tree or mismatched manifest, lock, identity, and snapshot survive publication | Reset/open fails loudly or publishes one mutually agreeing current baseline and v4 claim. |
| `sibling-drift` × old/current fixture | Frozen manifest input, snapshot descriptor, reconstructed bytes, definition, claim, or runtime tuple diverges | Exact identity and byte assertions fail before accepting the cross-build journey. |

## Out of scope

- Automatic migration, merge, or preservation of edits from an identity-mismatched
  project. ADR-0278 makes Reset the explicit whole-project destructive path.
- A second catalog transaction, lock, FIFO, migration ledger, trust cache, or
  package-acquisition fallback.
- Generic Vite-version upgrades or packages other than exact Vite 8.0.16 under
  ADR-0336.
- Browser/profile crash recovery while compensation runs; this unit is robust,
  not a new production-tier crash protocol.

## Decisions

- `terminal-checkpoint:
  c043302541f639464d310fe1e9ab74a4c084f136` — second Contract+RED BLOCKED;
  this unit receives no third checkpoint.
- `checkpoint-lineage: [fbe9249181a4d6ed3c0126d4177f38dfe35b1f78,
  c043302541f639464d310fe1e9ab74a4c084f136]`.
- `split-successors: [playground/project-activation-open-compensation,
  playground/vite8-durable-tree-replacement-proof]`.
- Contract+RED @ `c043302541f639464d310fe1e9ab74a4c084f136`
  blocked: the activation-only compensation boundary lacked create/save
  post-mutation-open sibling guards and an explicit confirmation that
  reset/delete remain with their existing recovery owners.
- Contract+RED @ `fbe9249181a4d6ed3c0126d4177f38dfe35b1f78`
  blocked: the durable oracle did not compare the complete old/current tree,
  and restored-context App binding failure lacked causal aggregation/cleanup
  RED coverage.
- `split-predecessor:
  140c0b3d3b98a1c684a51720a6acc8b4386fcb4d`; predecessor checkpoints:
  `2a1995766969e63deb1d5e777ac82be9203d88c9` and
  `140c0b3d3b98a1c684a51720a6acc8b4386fcb4d`.
- Historical ready verdict before the terminal split: 2026-07-28 —
  ADR-0278/0329/0336 and the predecessor split settled scope and overlap; the
  reproducible 7177b9da→23948c3d same-origin Chromium artifact plus the closure
  oracle settled identity, provenance, Reset, and offline-reopen evidence;
  source and carrier suites settled OPFS/MessagePort reachability and
  compensation/error/close boundaries; existing App FIFO,
  catalog/definition/install authorities, and causal cleanup required no new
  mechanism.

- Identity mismatch remains the loud stale-project signal; no old identity is
  relabelled as current.
- The user explicitly chooses existing Reset after the failed switch. Reset
  retains A's durable id/card and deletes the entire old project tree.
- Only `activate` compensates after target-open rejection because it changes one
  reversible catalog pointer. Create, Save, Reset, and Delete retain their
  existing owner transactions and recovery semantics.
- `catalog.activate` retains its existing in-flight target publication. The
  compensation guarantee is exact at transition settlement: B is republished
  and live before A's rejection reaches App error presentation.
- Compensation runs inline inside the already admitted App operation, directly
  through the existing catalog authority. It adds no serializer and cannot
  recursively enqueue.
- Successful compensation rethrows the original A failure. Failed compensation
  aggregates `[target failure, restore failure]` in causal order.
- App binding recovery uses the existing causal cleanup helper so a secondary B
  bind failure cannot erase the original A invalidation.
- The acceptance fixture is a frozen historical build-input/delta oracle, not a
  fake Workbench or package provider; all observable project operations use the
  real browser product.

## Reversibility

REVERSIBLE proof and lifecycle repair under accepted ADR-0336; no new public API
or cache mechanism.
