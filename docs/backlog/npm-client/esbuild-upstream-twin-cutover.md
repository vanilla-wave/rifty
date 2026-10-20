---
area: npm-client
status: ready
title: Select stock esbuild Node twins throughout the COI Workbench host
created: 2026-10-16
why: installer/runtime prerequisites pass but the physical host still restores and activates the legacy recipe
epic: esbuild-upstream-twin
sources: [ADR-0543, ADR-0226, ADR-0371, ADR-0361, ADR-0316, ADR-0375, ADR-0384]
code: [packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/glue/npm-shell-command.ts, tools/shadow-registry/src/runtime/runtime-adapters.ts, tools/shadow-registry/src/runtime/entry-preparation.ts, tools/compat-matrix-generator/cli.js]
---

## Context

Range install, stock Node stdio/child behavior, local npx and current-catalog
snapshot projection are accepted prerequisites. Physical Workbench still uses
the default no-COI policy; runtime-adapters statically imports the generated
client. The new host selects existing policies at their composition points.

## Acceptance

1. Physical COI owner selects COI for fresh/terminal install, snapshot
   restore/application and install claims. The scenario's three ranges resolve
   to upstream 0.21.5/0.25.12/0.28.2, complete upstream trees unchanged; saved
   trees reopen offline. Snapshot pins, including 0.28.0, stay unchanged. → I1
2. No generated esbuild module loads in COI, including an instant Vite snapshot
   and direct Node entry. Legacy binding activation is refused before import;
   no silent fallback. No-COI loads its existing generated client on demand. → I1/I4
3. All verified versions run the same async/lifecycle/CLI pipe/TTY/file suite
   against stock esbuild-wasm on Node 24. Every Sync method remains named loud
   on both upstream routes. Existing generated-client checks remain the
   no-COI authority; COI assertions use the live stock oracle. → I2/I5
4. Vite 7.3.6 build/dev/HMR/optimize and Vite 8.0.16 existing lanes pass;
   Vite 6.4.4 `npm install && npx vite build` reaches its real CLI. No COI
   version gate; other versions remain not verified. Starter pin unchanged. → I2/I6
5. No-COI install/build and ADR-0375 exact fixture bytes stay unchanged;
   incompatible ranges/pins name no-COI. Both hosts pass their explicit policy
   to the accepted installer/snapshot/claim owners. → I4; ADR-0375
6. CI executes the version-agnostic differential; only a version string and
   original archive are per-version inputs. Compat names verified versions,
   other admitted versions not verified, Sync partial; adaptation inventory
   distinguishes retired COI patches and retained no-COI platform debt. → I4/I5/I6

## Reference contract

Node 24.16.0 + unmodified esbuild-wasm 0.21.5/0.25.12/0.28.2; browser carrier
`esbuild-upstream-twin.spec.ts` executes the identical source/CLI under both
hosts. Raw package versions already pass; esbuild alias remains expected RED.
`esbuild-upstream-host.spec.ts` proves instant snapshot policy and records
context-wide generated-module requests. `vite6-upstream-cli.spec.ts` uses real
registry archives and Node's own build-action error for a missing index.html;
this proves CLI reachability, not an additional verified Vite lane.

## Parity cases

1. Shared stock API: initialize/reinitialize, transform + diagnostics, build,
   metadata, plugin hooks, context rebuild/cancel/watch/serve, dispose,
   stop/restart. Same script on Node and Chromium, all verified versions. → I2
2. Real local npx CLI with TTY/pipe/file: compare output/file/exit to Node;
   Node 24 file-stdout quirk preserved by generic Writable semantics. → I2
3. Existing Vite config graph, dependency optimizer/prebundle, module identity,
   large transform and validation rows move to stock wasm Node oracle; existing
   no-COI/native fixtures remain intact. → I2/I4; ADR-0375

## Fault matrix

| Boundary / axis | Outcome / carrier | Trace |
|---|---|---|
| Host policy / sibling drift | instant snapshot and fresh install both select stock entry | I1 |
| Runtime activation / provenance lie | legacy binding in COI fails before generated import | I1 |
| Saved tree / offline source | current policy claim reopens without registry; wrong-tier claim is not trusted | I1/I4 |
| No-COI install / unsupported pin | named tier refusal; prior files preserved | I4 |

Accepted snapshot preflight, package acquisition FIFO and stamp authority keep
ownership. No new cache, lock, ledger or transport.

## Challenge

challenge: 2026-10-20 — clear; prerequisite carriers settle the earlier Node
and install questions. Reuse explicit runtimeTier, accepted snapshot projection
and bound claim authority. A facade loading either runtime conditionally would
violate I1; an admission list would violate I5/I6. Goal's checked premise and
rejected routes apply unchanged.

## Out of scope

Real Sync execution, no-COI stock child support, catalog migration, additional
verified Vite lanes, retirement of the starter pin. Their existing goal
boundaries remain. No change to ADR-0375 fixture pins or byte oracle.

## Decisions

- ready-verdict: 2026-10-20 — Contract+RED @ 1e9b2654cb3b3469f32f1ac593fe2f35cf4f75c4

- 2026-10-20 — ADR-0543 owns host policy and stock oracle; DEC-2 corrections
  name the COI supersession of ADR-0226/0316/0371/0361 and retained no-COI debt.
- 2026-10-20 — PR-4: COI's generated publication/native-error assertions
  contradict the chosen stock oracle. Replace with live stock output/module
  identity, preserve all scenario rows and no-COI native fixtures.
