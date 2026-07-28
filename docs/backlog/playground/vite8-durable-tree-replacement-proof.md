---
area: playground
status: draft
title: Durable Vite 8 tree replacement proof
created: 2026-07-28
why: ADR-0336 changed Vite 8's exact manifest and snapshot identity, but the browser suite does not yet prove that Reset deletes a pre-policy trusted tree and same-card reopen reuses only the current tree offline
user_story: As a user reopening a saved Vite 8 project after the runtime-policy upgrade, I want explicit Reset to replace every stale dependency byte and then reuse the exact current project offline, but today that cross-build path has no committed acceptance proof
sources: [ADR-0278, ADR-0329, ADR-0336, docs/backlog/playground/reference/vite8-durable-reopen-contract-red.md, docs/backlog/playground/reference/vite8-durable-reopen-cross-build-probe.md, docs/backlog/playground/reference/vite8-durable-tree-replacement-refine-probe.md, docs/backlog/playground/reference/vite8-wasi-runtime-closure-probe.md]
code: [tests/e2e/vite8-durable-reopen-invalidation.spec.ts, tests/e2e/helpers/vite8-cross-build.ts]
---

## Context

Terminal predecessor `playground/vite8-durable-reopen-invalidation` mixed the
activation/open state repair with a 367-path historical/current byte oracle.
The serial substrate `playground/project-activation-open-compensation` owns the
only product-code change. This successor owns the browser acceptance carrier:
real prior/current applications, one origin and BrowserContext, required OPFS,
existing project cards, real Workbench acquisition, Reset, and Vite execution.

The frozen `7177b9da` prior-policy inputs are byte-identical to the previously
probed `c0dc2286` application inputs. A compact delta reconstructs the exact
old snapshot from the current committed snapshot and rejects either-base drift.
The expanded RED already reached the sole activation half-switch failure after
proving the exact old tree; it is retained by the terminal transcript rather
than merged as a failing default test.

## Readiness blocker

Merged activation compensation restores live B after stale-A rejection.
Resetting inactive A therefore performs only the exact definition re-seed and
zero acquisition; the snapshot, v4 claim, lock, and 367-path dependency tree
appear on the later explicit online open. The predecessor carrier observed one
snapshot request and a complete tree during Reset only because its activation
half-switch had incorrectly left A catalog-active.

That behavior conflicts with unchanged Acceptance 5 and 7 plus the
`sibling-drift` fault row below: they require current dependency provenance and
a complete path/byte table during the distinct Reset phase. Manual refinement
must choose between the ADR-consistent phase boundary (Reset is seed-only with
no claim or acquisition; explicit open acquires and proves the complete current
tree) and eager inactive-Reset acquisition (new product behavior that
contradicts current open authority and exceeds this proof-only unit). The
pre-demotion `## Acceptance` and `## Parity cases` are retained verbatim below.

## User scenario

The prior application saves edited Vite 8 project A with its trusted
pre-policy tree, saves project B, and leaves B live. The current application
rejects stale A while B remains selected and live. The user cancels, then
confirms Reset on A's existing card, opens reset A online, switches to B, blocks
snapshot/registry traffic, and reopens the same A card successfully offline.

## Acceptance

1. One CI-active Chromium journey runs prior and current applications serially
   on the same origin and BrowserContext with required OPFS; no fake Workbench,
   catalog, package provider, or fresh-final-Starter shortcut closes it.
2. Prior A contains the old visible manifest, old snapshot descriptor and
   definition identity, v4 trust claim, user edit, and exact pre-policy
   `postcss@8.5.23` lock/tree bytes. Prior B is observably live before restart.
3. Current stale-A selection rejects with `ProjectDefinitionMismatchError`
   before snapshot, registry, acquisition, or A-runtime effects; after
   settlement the same B ref and a fresh live B session are restored.
4. Reset Cancel changes no A bytes, ref, B session, or network counter.
   Confirmed Reset retains A's card/id while deleting the edit and every old
   tree byte.
5. Reset/current A agrees across visible alias
   `@napi-rs/wasm-runtime: npm:@napi-rs/wasm-runtime@1.1.6`, snapshot
   `sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da`,
   definition identity, v4 claim, `postcss@8.5.24` lock/tree, and executed
   Rolldown binding/core/runtime tuple `1.0.3 / 1.10.0 / 1.10.0 / 1.1.6`.
6. After one online open, B→the same A card reaches Vite build/preview with
   snapshot and registry routes blocked; both acquisition counters remain zero.
7. The full old, reset-current, current-open, and offline-reopen trees compare
   every path and byte/hash against the external snapshot/lock oracle. Only the
   generated install-stamp file is excluded from tree comparison because its
   v4 claim is asserted separately.

## Reference contract

- Prior-policy input: `7177b9da`.
- Current-policy repair: `23948c3dd54989eaa5c01543fa92e8d717d94f19`.
- Browser/toolchain: Chrome for Testing 148.0.7778.96, Playwright 1.60.0,
  Node 24.16.0.
- Temporal artifact:
  `docs/backlog/playground/reference/vite8-durable-reopen-cross-build-probe.md`.
- Current closure oracle:
  `docs/backlog/playground/reference/vite8-wasi-runtime-closure-probe.md`.

## Parity cases

This is an own-product temporal/storage contract; no Node API behavior is
claimed.

1. Exact old A rejects before acquisition and leaves current B live.
2. Cancel is a no-op; confirmed Reset replaces the complete old baseline at
   the same durable id.
3. Current online A and offline same-card A have identical current provenance,
   tree bytes, Vite build, and preview behavior.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome |
|---|---|---|
| `poisoned-cache` × stale open | Old definition/claim/tree survives upgrade | Mismatch rejects before acquisition/runtime; no old byte executes. |
| `provenance-lie` × Reset | Mixed old/current manifest, lock, claim, or tree | Exact oracle comparison fails; no current provenance is claimed. |
| `sibling-drift` × fixture phases | Old, reset, online, or offline tree diverges | Every phase's complete path/byte table fails. |
| `false-fallback` × offline reopen | Same-card tree silently reacquires | Blocked counted routes make any snapshot/registry request fail acceptance. |

## Out of scope

- Product activation compensation; the prerequisite successor owns it.
- Automatic migration or preservation of edits across definition mismatch.
- Vite versions other than exact 8.0.16 or a fresh final Starter/project id.
- A second install cache, catalog transaction, migration ledger, or fallback.

## Decisions

ready-verdict: 2026-07-28 — ADR-0278/0329/0336, the terminal split, and the merged activation-compensation prerequisite settle scope, overlap, Reset authority, and dependency order; the reachable 7177b9da→23948c3d same-origin Chromium artifact, frozen definition/snapshot delta, and WASI closure oracle settle identity, OPFS reachability, exact old/current provenance, Reset, and zero-acquisition reopen evidence; the prior complete-tree Contract+RED carrier plus current activation and owner suites settle the Parity/Fault targets and storage/network boundaries; existing App FIFO, catalog/definition/package authorities, v4 install claims, and the e2e harness supply the required carrier without a new production mechanism.

- `split-predecessor:
  c043302541f639464d310fe1e9ab74a4c084f136`; predecessor checkpoints:
  `fbe9249181a4d6ed3c0126d4177f38dfe35b1f78` and
  `c043302541f639464d310fe1e9ab74a4c084f136`.
- This is a proof-only successor. It changes no production authority and adds
  no mechanism; the prerequisite activation unit owns the behavioral repair.
- The prior tree is reconstructed from frozen application inputs plus a compact
  exact snapshot delta. Current acquisition's deterministic Vite CLI/watcher
  finalization is part of the byte oracle.
- Generated `.rifty-install-stamp.json` bytes are not stable project content;
  the exact v4 claim is asserted separately instead of self-referencing it.

## Reversibility

REVERSIBLE browser acceptance proof; no product API or persistent format change.
